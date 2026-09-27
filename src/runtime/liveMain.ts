import type { RaceObservation } from '../reconcile/reconcile.js';
import type { ApiRecording } from '../replay/apiRecording.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import type { MatchStore } from '../sources/air/matchStore.js';
import type { HttpJson } from '../sources/http.js';
import type { DdhqEnvironment } from '../sources/provider/providerSource.js';
import type { QueryStore } from '../sources/provider/queryStore.js';
import type { WebApiRecording } from '../web/server.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import { loadApiRecording, resolveApiRecordingFile } from '../replay/apiRecording.js';
import { makeSessionFiles } from '../replay/sessionFiles.js';
import { makeSettingsStore } from '../settings/settingsStore.js';
import { makeAirSource } from '../sources/air/airSource.js';
import { DEFAULT_BROWSER_URL } from '../sources/air/browserCapturer.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import { makeMatchStore } from '../sources/air/matchStore.js';
import { openTestPlayer, TEST_PLAYER_PATH } from '../sources/air/testPlayer.js';
import { makeFetchHttp } from '../sources/http.js';
import { ddhqBaseUrl, makeProviderSource } from '../sources/provider/providerSource.js';
import { makeQueryStore } from '../sources/provider/queryStore.js';
import {
	makePlaybackClock,
	makePlaybackHttp,
	makeRecordingHttp,
} from '../sources/recordingHttp.js';
import { makeVendorSource } from '../sources/vendor/vendorSource.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { makeRecordingLlmClient } from '../vision/llmClient.js';
import { makeChangeBus } from '../web/changeBus.js';
import { makeWebServer } from '../web/server.js';
import { makeAlertLog } from './alertLog.js';
import { makeAnomalyTracker } from './anomalyTracker.js';
import { makeApiRecorder } from './apiRecorder.js';
import makeComposition from './composition.js';
import { makeLiveSession } from './liveSession.js';
import { observationChanged } from './observationChanged.js';
import { errorMessage, makeSourceErrors } from './sourceErrors.js';

//   CAPTURE_MODE=interval|manual     air cadence (default interval)
//   CAPTURE_INTERVAL_MS=<n>          default 5000; interval mode only
//   WEB_PORT=<n>                     web view port (default 8787)
const readCaptureMode = (): CaptureMode =>
	process.env.CAPTURE_MODE === 'manual' ? 'manual' : 'interval';
const readIntervalMs = (): number => {
	const raw = Number(process.env.CAPTURE_INTERVAL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

//   --api-playback <name|file.sqlite>  answer DDHQ + Chameleon from an API recording
//   --speed=<n>                        playback speed (default 1)
const argValue = (flag: string): string | undefined => {
	const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
	if (inline !== undefined) return inline.slice(flag.length + 1);
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
};
const readPlaybackSpeed = (): number => {
	const raw = Number(argValue('--speed'));
	return Number.isFinite(raw) && raw > 0 ? raw : 1;
};

// The API recording's 60 s check interval, held while recording.
const API_RECORD_INTERVAL_MS = 60_000;

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

	const playbackName = argValue('--api-playback');
	const playback: ApiRecording | undefined =
		playbackName === undefined
			? undefined
			: loadApiRecording(resolveApiRecordingFile('recordings', playbackName));
	const playbackClock =
		playback === undefined
			? undefined
			: makePlaybackClock(playback, { speed: readPlaybackSpeed() });

	// Persisted DDHQ query list: in-memory, seeded from settings, writes through so UI
	// edits survive restarts. In playback the list is the recording's, and fixed.
	const memoryQueries = makeQueryStore(
		playback === undefined ? settings.getQueries() : playback.meta.ddhqQueries,
	);
	const liveQueryStore: QueryStore = {
		get: memoryQueries.get,
		set: (next) => {
			memoryQueries.set(next);
			if (playback === undefined) settings.setQueries(memoryQueries.get());
		},
	};

	let providerScheduler: ReturnType<typeof makeCaptureScheduler> | undefined;
	let providerIntervalMs = API_RECORD_INTERVAL_MS;
	const apiRecorder = makeApiRecorder({
		baseDir: 'recordings',
		getQueries: liveQueryStore.get,
		onStart: () => providerScheduler?.reconfigure({ intervalMs: API_RECORD_INTERVAL_MS }),
		onStop: () => providerScheduler?.reconfigure({ intervalMs: providerIntervalMs }),
	});
	const sourceHttp = (source: 'DDHQ' | 'Ross'): HttpJson =>
		playback !== undefined && playbackClock !== undefined
			? makePlaybackHttp(playback, source, playbackClock)
			: makeRecordingHttp(makeFetchHttp(), source, apiRecorder.record);

	// DDHQ provider source — queries are runtime state (queryStore), set via the web
	// view; nothing polls until queries are added. Started when creds are present, or
	// always in playback.
	let queryStore: QueryStore | undefined;
	let ddhqEnvironment:
		| { get: () => DdhqEnvironment; set: (next: DdhqEnvironment) => void }
		| undefined;
	if (process.env.DDHQ_CLIENT_ID !== undefined || playback !== undefined) {
		// A poll with any failed query counts as failed, so one bad query can't hide
		// behind the others succeeding.
		let queryFailures: string[] = [];
		// Production or DDHQ's integration host; persisted, and moot in playback.
		let environment = settings.getDdhqEnvironment();
		const provider = makeProviderSource(ingest, liveQueryStore, {
			getEnvironment: () => environment,
			http: sourceHttp('DDHQ'),
			onQueryError: (query, error) => queryFailures.push(`query ${query}: ${errorMessage(error)}`),
			playback: playback !== undefined,
		});
		queryStore = provider.queryStore;
		if (playback === undefined)
			ddhqEnvironment = {
				get: () => environment,
				set: (next) => {
					environment = next;
					settings.setDdhqEnvironment(next);
					console.log(`[provider] DDHQ environment → ${next} (${ddhqBaseUrl(next)})`);
				},
			};
		providerIntervalMs = provider.intervalMs;
		providerScheduler = makeCaptureScheduler({
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
			`[provider] DDHQ ${playback === undefined ? `${environment} (${ddhqBaseUrl(environment)})` : 'playback'} polling every ${provider.intervalMs}ms (queries set via web view).`,
		);
	} else {
		console.log('[provider] DDHQ not configured (no DDHQ_CLIENT_ID) — skipping.');
	}

	// Chameleon vendor source — fixed playlist URL, always on, once per minute (VPN-only).
	const vendor = makeVendorSource(ingest, sourceHttp('Ross'));
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

	const apiRecording: WebApiRecording =
		playback !== undefined && playbackClock !== undefined
			? {
					body: apiRecorder.body,
					list: apiRecorder.list,
					meta: apiRecorder.meta,
					responses: apiRecorder.responses,
					status: () => ({
						durationMs: playbackClock.durationMs,
						elapsedMs: Math.min(playbackClock.elapsedMs(), playbackClock.durationMs),
						ended: playbackClock.ended(),
						mode: 'playback',
						name: playback.meta.name,
						speed: playbackClock.speed,
					}),
				}
			: apiRecorder;
	if (playback !== undefined && playbackClock !== undefined) {
		console.log(
			`[api-playback] ${playback.meta.name}: ${playback.responses.length} responses over ${Math.round(playbackClock.durationMs / 60_000)} min at ${playbackClock.speed}x`,
		);
		const endWatch = setInterval(() => {
			if (!playbackClock.ended()) return;
			clearInterval(endWatch);
			console.log(
				'[api-playback] reached the end of the recording; the last responses keep being served.',
			);
		}, 5_000);
		endWatch.unref();
	}

	// Web view: state per source, recent alerts, last frame, manual capture button,
	// editable DDHQ queries.
	const webPort = Number(process.env.WEB_PORT) || 8787;
	const web = makeWebServer({
		apiRecording,
		changeBus,
		getAlertHistory: alertLog.recent,
		getCadence: airScheduler.getConfig,
		getLastFrame: airSource.getLastFrame,
		getRecentAlerts: anomalies.list,
		getSourceError: sourceErrors.get,
		matchStore: airSource.matchStore,
		onRaceRelink: applyRelink,
		raceIdentity,
		reconcileRace: composition.reconcileRace,
		session,
		sessions: makeSessionFiles('recordings', session.currentId),
		setCadence: airScheduler.reconfigure,
		store: composition.store,
		testVideos: {
			dir: 'recordings/video',
			open: (file) =>
				openTestPlayer(
					DEFAULT_BROWSER_URL,
					`http://localhost:${webPort}${TEST_PLAYER_PATH}${encodeURIComponent(file)}`,
				),
		},
		triggerCapture: airScheduler.triggerCapture,
		...(queryStore === undefined ? {} : { queryStore }),
		...(ddhqEnvironment === undefined ? {} : { ddhqEnvironment }),
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

	// An API recording is fed by the pollers, so it can't outlive monitoring.
	monitored.push(airScheduler, { start: () => undefined, stop: apiRecorder.stop });
	const started = session.start();
	await web.listen({ port: webPort });
	console.log(
		`[live] session ${started.id} ready · air mode=${mode}${mode === 'interval' ? ` every ${intervalMs}ms` : ' (manual)'} · web http://localhost:${webPort}`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
