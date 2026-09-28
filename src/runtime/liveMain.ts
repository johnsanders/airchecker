import type { RaceObservation } from '../reconcile/reconcile.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import type { MatchStore } from '../sources/air/matchStore.js';
import type { DdhqEnvironment } from '../sources/provider/providerSource.js';
import type { QueryStore } from '../sources/provider/queryStore.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import { makeSessionFiles } from '../replay/sessionFiles.js';
import { makeSettingsStore } from '../settings/settingsStore.js';
import { makeAirSource } from '../sources/air/airSource.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import { makeMatchStore } from '../sources/air/matchStore.js';
import { errorMessage } from '../sources/http.js';
import { ddhqBaseUrl, makeProviderSource } from '../sources/provider/providerSource.js';
import { makeQueryStore } from '../sources/provider/queryStore.js';
import { makeVendorSource } from '../sources/vendor/vendorSource.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { makeRecordingLlmClient } from '../vision/llmClient.js';
import { makeChangeBus } from '../web/changeBus.js';
import { makeWebServer } from '../web/server.js';
import { makeAlertLog } from './alertLog.js';
import { makeAnomalyTracker } from './anomalyTracker.js';
import makeComposition from './composition.js';
import { makeLiveSession } from './liveSession.js';
import { observationChanged } from './observationChanged.js';
import { makeSourceErrors } from './sourceErrors.js';

//   CAPTURE_MODE=interval|manual     air cadence (default interval)
//   CAPTURE_INTERVAL_MS=<n>          default 5000; interval mode only
//   WEB_PORT=<n>                     web view port (default 8787)
const readCaptureMode = (): CaptureMode =>
	process.env.CAPTURE_MODE === 'manual' ? 'manual' : 'interval';
const readIntervalMs = (): number => {
	const raw = Number(process.env.CAPTURE_INTERVAL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

const liveMain = async (): Promise<void> => {
	const missingKeys = missingLiveKeys();
	if (missingKeys.length > 0) {
		console.error(
			`${missingKeys.join(', ')} not set — live vision needs both (Haiku on Anthropic for pass 1, Gemini via OpenRouter for the crop read).`,
		);
		process.exit(1);
	}
	// Pollers and the air scheduler are created further down; the session only needs
	// them once monitoring is started or stopped.
	const monitored: { start: () => void; stop: () => void }[] = [];
	const session = makeLiveSession({
		baseDir: 'recordings',
		onStart: () => monitored.forEach((scheduler) => scheduler.start()),
		onStop: () => monitored.forEach((scheduler) => scheduler.stop()),
	});
	const recorder = session.recorder;
	const composition = makeComposition({ onRecord: recorder.recordObservation });

	// Persistent config (survives restarts), separate from the session-scoped recorder DB.
	const settings = makeSettingsStore('recordings/settings.sqlite');

	const llmClient = makeRecordingLlmClient(makeLiveLlmClient(), recorder);
	const raceIdentity = makeRaceIdentityResolver({
		llmClient,
		onError: (error) => console.error('[identity] resolver error', error),
		onEvent: recorder.recordIdentityEvent,
		settings,
	});

	// Pushes a "changed" nudge to live web clients so they refetch on demand instead
	// of polling on a timer. Broadcast wherever server state settles.
	const changeBus = makeChangeBus();
	const sourceErrors = makeSourceErrors({
		onChange: () => changeBus.broadcast({ type: 'changed' }),
	});

	// Current anomalies per race for the web view. Reconciliation re-runs on every
	// batch over the races it touched; the tracker replaces a race's anomalies each
	// time, so a standing anomaly shows once and a resolved one clears (rather than
	// re-appending duplicates every poll).
	const anomalies = makeAnomalyTracker(composition.thresholds);
	// Every raise/clear is appended to the session recording and printed as one JSON
	// line (`[alert] {...}`), so a transient alert survives an operator's blink and
	// `tail -f` of the process log works in the truck.
	const alertLog = makeAlertLog({
		onEvent: (event) => {
			recorder.recordAlertEvent(event);
			console.log(`[alert] ${JSON.stringify(event)}`);
		},
	});
	const reconcileKeys = (raceKeys: Iterable<string>): void => {
		const now = Date.now();
		const events = Array.from(new Set(raceKeys)).flatMap((raceKey) =>
			alertLog.record(anomalies.update(raceKey, composition.reconcileRace(raceKey, now)), now),
		);
		if (events.length > 0)
			changeBus.broadcast({ raceKeys: events.map((event) => event.raceKey), type: 'changed' });
	};
	const reconcileTouched = (observations: RaceObservation[]): void => {
		reconcileKeys(observations.map((o) => o.raceKey));
	};
	const ingest = async (observations: RaceObservation[]): Promise<RaceObservation[]> => {
		const resolved = await Promise.all(
			observations.map((observation) => raceIdentity.resolveObservation(observation)),
		);
		// Only nudge clients about races whose rendered data actually moved — sources
		// re-poll on a timer and append identical observations (and air emits an empty
		// batch when no graphic is up), which must not read as a change. Computed before
		// record() so we compare against the prior latest.
		const changedKeys = Array.from(
			new Set(
				resolved
					.filter((observation) => {
						const history = composition.store.getHistory(observation.source, observation.raceKey);
						return observationChanged(history[history.length - 1], observation);
					})
					.map((observation) => observation.raceKey),
			),
		);
		resolved.forEach(composition.store.record);
		reconcileTouched(resolved);
		// One nudge covers every source and the air frame panel: an air capture awaits
		// this ingest before setting its lastFrame (synchronously, before any client
		// refetch could return), so /api/state is already current when the client reads.
		if (changedKeys.length > 0) changeBus.broadcast({ raceKeys: changedKeys, type: 'changed' });
		return resolved;
	};
	const applyRelink = (
		source: RaceObservation['source'],
		sourceRaceKey: string,
		canonicalRaceKey: string,
	): void => {
		const result = composition.store.rekeySourceRace(source, sourceRaceKey, canonicalRaceKey);
		if (result.fromRaceKeys.length === 0) return; // nothing actually re-bucketed
		reconcileKeys([...result.fromRaceKeys, result.toRaceKey]);
		changeBus.broadcast({ raceKeys: [...result.fromRaceKeys, result.toRaceKey], type: 'changed' });
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
	const airSource = makeAirSource({ llmClient, matchStore, onObservations: ingest, recorder });
	const mode = readCaptureMode();
	const intervalMs = readIntervalMs();
	const airScheduler = makeCaptureScheduler({
		captureOnce: () => airSource.captureOnce().then(() => sourceErrors.ok('air')),
		intervalMs,
		mode,
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
	// the Sim environment (elex_sim) doesn't.
	if (process.env.DDHQ_CLIENT_ID === undefined)
		console.warn('[provider] DDHQ_CLIENT_ID not set — DDHQ works in the Sim environment only.');
	// A poll with any failed query counts as failed, so one bad query can't hide
	// behind the others succeeding.
	let queryFailures: string[] = [];
	// Production, DDHQ's integration host, or elex_sim's mirror (Chameleon follows it
	// there too); persisted.
	let environment = settings.getDdhqEnvironment();
	const provider = makeProviderSource(ingest, liveQueryStore, {
		getEnvironment: () => environment,
		onQueryError: (query, error) => queryFailures.push(`query ${query}: ${errorMessage(error)}`),
	});
	const ddhqEnvironment = {
		get: () => environment,
		set: (next: DdhqEnvironment) => {
			environment = next;
			settings.setDdhqEnvironment(next);
			console.log(`[provider] DDHQ environment → ${next} (${ddhqBaseUrl(next)})`);
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
		`[provider] DDHQ ${environment} (${ddhqBaseUrl(environment)}) polling every ${provider.intervalMs}ms (queries set via web view).`,
	);

	// Chameleon vendor source — fixed playlist URL, always on, once per minute (VPN-only).
	const vendor = makeVendorSource(ingest, { getEnvironment: () => environment });
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

	// Web view: state per source, recent alerts, last frame, manual capture button,
	// editable DDHQ queries.
	const webPort = Number(process.env.WEB_PORT) || 8787;
	const web = makeWebServer({
		changeBus,
		ddhqEnvironment,
		getAlertHistory: alertLog.recent,
		getCadence: airScheduler.getConfig,
		getLastFrame: airSource.getLastFrame,
		getRecentAlerts: anomalies.list,
		getSourceError: sourceErrors.get,
		matchStore: airSource.matchStore,
		onRaceRelink: applyRelink,
		queryStore: provider.queryStore,
		raceIdentity,
		reconcileRace: composition.reconcileRace,
		session,
		sessions: makeSessionFiles('recordings', session.currentId),
		setCadence: airScheduler.reconfigure,
		store: composition.store,
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
		`[live] ready, monitoring stopped (Start in the web view) · air mode=${mode}${mode === 'interval' ? ` every ${intervalMs}ms` : ' (manual)'} · web http://localhost:${webPort}`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
