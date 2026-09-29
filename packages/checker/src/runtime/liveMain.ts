import type { RaceObservation } from '../reconcile/reconcile.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import type { MatchStore } from '../sources/air/matchStore.js';
import type { DdhqHost, Mode } from '../sources/provider/providerSource.js';
import type { QueryStore } from '../sources/provider/queryStore.js';

import { makeSessionFiles } from '../replay/sessionFiles.js';
import { makeSettingsStore } from '../settings/settingsStore.js';
import { makeAirSource } from '../sources/air/airSource.js';
import {
	DEFAULT_URL_MATCH,
	DIRECTV_PLAYER_URL,
	makeBrowserCapturer,
} from '../sources/air/browserCapturer.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import { makeMatchStore } from '../sources/air/matchStore.js';
import { errorMessage } from '../sources/http.js';
import { ddhqBaseUrl, makeProviderSource, simBaseUrl } from '../sources/provider/providerSource.js';
import { makeQueryStore } from '../sources/provider/queryStore.js';
import { makeVendorSource } from '../sources/vendor/vendorSource.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { makeRecordingLlmClient } from '../vision/llmClient.js';
import { makeChangeBus } from '../web/changeBus.js';
import { makeWebServer } from '../web/server.js';
import makeComposition from './composition.js';
import { makeLiveSession } from './liveSession.js';
import { makeSourceErrors } from './sourceErrors.js';

//   CAPTURE_MODE=interval|manual     air cadence (default interval)
//   CAPTURE_INTERVAL_MS=<n>          default 9000; interval mode only
//   WEB_PORT=<n>                     web view port (default 8787)
const readCaptureMode = (): CaptureMode =>
	process.env.CAPTURE_MODE === 'manual' ? 'manual' : 'interval';
const readIntervalMs = (): number => {
	const raw = Number(process.env.CAPTURE_INTERVAL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 9000;
};

const liveMain = async (): Promise<void> => {
	const missingKeys = missingLiveKeys();
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set — air is read by Gemini, direct from Google.`);
		process.exit(1);
	}
	// Pollers and the air scheduler are created further down; the session only needs
	// them once monitoring is started or stopped.
	const monitored: { start: () => void; stop: () => void }[] = [];

	// Persistent config (survives restarts), separate from the session-scoped recorder DB.
	const settings = makeSettingsStore('recordings/settings.sqlite');

	// Live watches the real sources; Sim watches the simulator on all three. In Live, DDHQ
	// is production or its integration host. Both persist; the mode can only change while
	// monitoring is stopped, so a session never mixes the two.
	let mode = settings.getMode();
	let ddhqHost = settings.getDdhqHost();

	const session = makeLiveSession({
		baseDir: 'recordings',
		meta: () => ({ mode }),
		// Arrow bodies, not references: the composition and schedulers are made further down.
		onStart: () => {
			composition.reset();
			monitored.forEach((scheduler) => scheduler.start());
		},
		onStop: () => monitored.forEach((scheduler) => scheduler.stop()),
	});
	const recorder = session.recorder;
	// Every alert event is appended to the session recording and printed as one JSON line
	// (`[alert] {...}`), so `tail -f` of the process log works in the truck.
	const composition = makeComposition({
		onAlertEvent: (event) => {
			recorder.recordAlertEvent(event);
			console.log(`[alert] ${JSON.stringify(event)}`);
		},
		onRecord: recorder.recordObservation,
	});

	const llmClient = makeRecordingLlmClient(makeLiveLlmClient(), recorder);

	// Pushes a "changed" nudge to live web clients so they refetch on demand instead
	// of polling on a timer. Broadcast wherever server state settles.
	const changeBus = makeChangeBus();
	const sourceErrors = makeSourceErrors({
		onChange: () => changeBus.broadcast({ type: 'changed' }),
	});

	// Clients are only nudged about races something new was recorded for: DDHQ and Ross
	// repeat themselves every poll, and air emits an empty batch when no graphic is up.
	// One nudge covers the air frame panel too: an air capture awaits this before setting
	// its lastFrame, so /api/state is already current when the client reads.
	const ingest = (observations: RaceObservation[]): RaceObservation[] => {
		const ingested = composition.ingest(observations);
		const raceKeys = Array.from(
			new Set([
				...ingested.recorded.map((observation) => observation.raceKey),
				...ingested.events.map((event) => event.raceKey),
			]),
		);
		if (raceKeys.length > 0) changeBus.broadcast({ raceKeys, type: 'changed' });
		return ingested.observations;
	};

	// Air source: real browser capture → extractFrame → store. Driven by the cadence
	// scheduler (interval or manual web button). The captured tab is persisted so a
	// restart keeps the operator's pick instead of snapping back to the default.
	const memoryMatch = makeMatchStore(settings.getAirMatch());
	const matchStore: MatchStore = {
		get: memoryMatch.get,
		set: (next) => {
			memoryMatch.set(next);
			settings.setAirMatch(memoryMatch.get());
		},
	};
	// In Sim the capturer grabs the simulator's /air/ page; the saved tab is Live's. With no
	// such tab open, it opens one: /air/ in Sim, the DirecTV player for Live's DirecTV preset.
	const simAirMatch = `${simBaseUrl().replace(/^https?:\/\//, '')}/air`;
	const captureMatch = (): string => (mode === 'sim' ? simAirMatch : matchStore.get());
	const airSource = makeAirSource({
		capturer: makeBrowserCapturer({
			openUrl: () => {
				if (mode === 'sim') return `${simBaseUrl()}/air/`;
				return matchStore.get() === DEFAULT_URL_MATCH ? DIRECTV_PLAYER_URL : undefined;
			},
			urlMatch: captureMatch,
		}),
		llmClient,
		matchStore: { get: captureMatch, set: matchStore.set },
		onObservations: ingest,
		recorder,
	});
	const captureMode = readCaptureMode();
	const intervalMs = readIntervalMs();
	const airScheduler = makeCaptureScheduler({
		captureOnce: () => airSource.captureOnce().then(() => sourceErrors.ok('air')),
		intervalMs,
		mode: captureMode,
		onError: (error) => sourceErrors.fail('air', error),
		onSkip: () => console.warn('[air] capture skipped — previous still in flight'),
	});

	// Persisted DDHQ query list: in-memory, seeded from settings, writes through so UI
	// edits survive restarts.
	const memoryQueries = makeQueryStore(settings.getQueries());
	const liveQueryStore: QueryStore = {
		get: memoryQueries.get,
		set: (next) => {
			memoryQueries.set(next);
			settings.setQueries(memoryQueries.get());
		},
	};

	// DDHQ provider source — queries are runtime state (queryStore), set via the web
	// view; nothing polls until queries are added. Live polling needs the DDHQ_* creds;
	// Sim mode (the simulator) doesn't.
	if (process.env.DDHQ_CLIENT_ID === undefined)
		console.warn('[provider] DDHQ_CLIENT_ID not set — DDHQ works in Sim mode only.');
	// A poll with any failed query counts as failed, so one bad query can't hide
	// behind the others succeeding.
	let queryFailures: string[] = [];
	const provider = makeProviderSource(ingest, liveQueryStore, {
		getHost: () => ddhqHost,
		getMode: () => mode,
		onQueryError: (query, error) => queryFailures.push(`query ${query}: ${errorMessage(error)}`),
	});
	const modeControl = {
		get: () => mode,
		set: (next: Mode) => {
			mode = next;
			settings.setMode(next);
			console.log(`[mode] ${next} (DDHQ ${ddhqBaseUrl(mode, ddhqHost)})`);
		},
	};
	const ddhqHostControl = {
		get: () => ddhqHost,
		set: (next: DdhqHost) => {
			ddhqHost = next;
			settings.setDdhqHost(next);
			console.log(`[provider] DDHQ host → ${next} (${ddhqBaseUrl(mode, ddhqHost)})`);
		},
	};
	const providerScheduler = makeCaptureScheduler({
		captureOnce: async () => {
			queryFailures = [];
			await provider.poller.pollOnce();
			if (queryFailures.length === 0) sourceErrors.ok('DDHQ');
			else sourceErrors.fail('DDHQ', queryFailures.join('; '));
		},
		immediate: true,
		intervalMs: provider.intervalMs,
		mode: 'interval',
		onError: (error) => sourceErrors.fail('DDHQ', error),
		onSkip: () => console.warn('[provider] poll skipped — previous still in flight'),
	});
	monitored.push(providerScheduler);
	console.log(
		`[provider] ${mode} mode, DDHQ ${ddhqBaseUrl(mode, ddhqHost)} polling every ${provider.intervalMs}ms.`,
	);

	// Chameleon vendor source — fixed playlist URL (VPN-only).
	const vendor = makeVendorSource(ingest, { getMode: () => mode });
	const vendorScheduler = makeCaptureScheduler({
		captureOnce: () => vendor.poller.pollOnce().then(() => sourceErrors.ok('Ross')),
		immediate: true,
		intervalMs: vendor.intervalMs,
		mode: 'interval',
		onError: (error) => sourceErrors.fail('Ross', error),
		onSkip: () => console.warn('[vendor] poll skipped — previous still in flight'),
	});
	monitored.push(vendorScheduler);
	console.log(`[vendor] Chameleon polling every ${vendor.intervalMs}ms.`);

	// Web view: the on-air list, state per source, alert events, last frame, manual capture
	// button, editable DDHQ queries.
	const webPort = Number(process.env.WEB_PORT) || 8787;
	const web = makeWebServer({
		changeBus,
		composition,
		ddhqHost: ddhqHostControl,
		getCadence: airScheduler.getConfig,
		getLastFrame: airSource.getLastFrame,
		getSourceError: sourceErrors.get,
		getSourceLastOk: sourceErrors.lastOk,
		matchStore,
		mode: modeControl,
		queryStore: provider.queryStore,
		session,
		sessions: makeSessionFiles('recordings', session.currentId),
		setCadence: airScheduler.reconfigure,
		triggerCapture: airScheduler.triggerCapture,
	});

	let shuttingDown = false;
	const shutdown = (): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		session.stop();
		void airSource.close();
		void web.close();
		settings.close();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	// Boots stopped: nothing polls, captures or records until Start in the web view.
	monitored.push(airScheduler);
	await web.listen({ port: webPort });
	console.log(
		`[live] ready, monitoring stopped (Start in the web view) · ${mode} mode · air ${captureMode}${captureMode === 'interval' ? ` every ${intervalMs}ms` : ''} · web http://localhost:${webPort}`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
