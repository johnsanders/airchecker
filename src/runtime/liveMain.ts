import { randomUUID } from 'node:crypto';

import type { Anomaly, RaceObservation } from '../reconcile/reconcile.js';
import type { CaptureMode } from '../sources/air/captureScheduler.js';
import type { QueryStore } from '../sources/provider/queryStore.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import makeRecorder from '../replay/recorder.js';
import { makeSettingsStore } from '../settings/settingsStore.js';
import { makeAirSource } from '../sources/air/airSource.js';
import { makeCaptureScheduler } from '../sources/air/captureScheduler.js';
import { makeProviderSource } from '../sources/provider/providerSource.js';
import { makeQueryStore } from '../sources/provider/queryStore.js';
import { makeVendorSource } from '../sources/vendor/vendorSource.js';
import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { makeRecordingLlmClient } from '../vision/llmClient.js';
import { makeWebServer } from '../web/server.js';
import makeComposition from './composition.js';

//   CAPTURE_MODE=interval|manual     air cadence (default interval)
//   CAPTURE_INTERVAL_MS=<n>          default 5000; interval mode only
//   WEB_PORT=<n>                     web view port (default 8787)
const readCaptureMode = (): CaptureMode =>
	process.env.CAPTURE_MODE === 'manual' ? 'manual' : 'interval';
const readIntervalMs = (): number => {
	const raw = Number(process.env.CAPTURE_INTERVAL_MS);
	return Number.isFinite(raw) && raw > 0 ? raw : 5000;
};

const RECENT_ALERTS_MAX = 200;

const liveMain = async (): Promise<void> => {
	const sessionId = `live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
	const recorder = makeRecorder({ baseDir: 'recordings', sessionId });
	const composition = makeComposition({ onRecord: recorder.recordObservation });

	// Persistent config (survives restarts), separate from the session-scoped recorder DB.
	const settings = makeSettingsStore('recordings/settings.sqlite');
	const llmClient = makeRecordingLlmClient(makeAnthropicLlmClient(), recorder);
	const raceIdentity = makeRaceIdentityResolver({
		llmClient,
		onError: (error) => console.error('[identity] resolver error', error),
		onEvent: recorder.recordIdentityEvent,
		settings,
	});

	// Rolling buffer of recent anomalies for the web view. Reconciliation runs after
	// each new batch of observations lands, over the races those observations touched.
	const recentAlerts: Anomaly[] = [];
	const reconcileKeys = (raceKeys: Iterable<string>): void => {
		const now = Date.now();
		Array.from(new Set(raceKeys)).forEach((raceKey) => {
			composition.reconcileRace(raceKey, now).forEach((anomaly) => recentAlerts.push(anomaly));
		});
		while (recentAlerts.length > RECENT_ALERTS_MAX) recentAlerts.shift();
	};
	const reconcileTouched = (observations: RaceObservation[]): void => {
		reconcileKeys(observations.map((o) => o.raceKey));
	};
	const ingest = async (observations: RaceObservation[]): Promise<RaceObservation[]> => {
		const resolved = await Promise.all(
			observations.map((observation) => raceIdentity.resolveObservation(observation)),
		);
		resolved.forEach(composition.store.record);
		reconcileTouched(resolved);
		return resolved;
	};
	const applyRelink = (
		source: RaceObservation['source'],
		sourceRaceKey: string,
		canonicalRaceKey: string,
	): void => {
		const result = composition.store.rekeySourceRace(source, sourceRaceKey, canonicalRaceKey);
		reconcileKeys([...result.fromRaceKeys, result.toRaceKey]);
	};

	// Air source: real browser capture → extractFrame → store. Driven by the cadence
	// scheduler (interval or manual web button).
	const airSource = makeAirSource({ llmClient, onObservations: ingest, recorder });
	const mode = readCaptureMode();
	const intervalMs = readIntervalMs();
	const airScheduler = makeCaptureScheduler({
		captureOnce: airSource.captureOnce,
		intervalMs,
		mode,
		onError: (error) => console.error('[air] capture error', error),
		onSkip: () => console.warn('[air] capture skipped — previous still in flight'),
	});

	// DDHQ provider source — queries are runtime state (queryStore), set via the web
	// view; nothing polls until queries are added. Started only when creds are present.
	let providerScheduler: ReturnType<typeof makeCaptureScheduler> | undefined;
	let queryStore: QueryStore | undefined;
	if (process.env.DDHQ_CLIENT_ID !== undefined) {
		// In-memory store seeded from the persisted list; writes-through to settings so
		// UI edits survive restarts. get() stays in-memory (no per-tick disk read).
		const memory = makeQueryStore(settings.getQueries());
		const persistentQueryStore: QueryStore = {
			get: memory.get,
			set: (next) => {
				memory.set(next);
				settings.setQueries(memory.get());
			},
		};
		const provider = makeProviderSource(ingest, persistentQueryStore);
		queryStore = provider.queryStore;
		providerScheduler = makeCaptureScheduler({
			captureOnce: provider.poller.pollOnce,
			immediate: true,
			intervalMs: provider.intervalMs,
			mode: 'interval',
			onError: (error) => console.error('[provider] poll error', error),
			onSkip: () => console.warn('[provider] poll skipped — previous still in flight'),
		});
		providerScheduler.start();
		console.log(
			`[provider] DDHQ polling every ${provider.intervalMs}ms (queries set via web view).`,
		);
	} else {
		console.log('[provider] DDHQ not configured (no DDHQ_CLIENT_ID) — skipping.');
	}

	// Chameleon vendor source — fixed playlist URL, always on, once per minute (VPN-only).
	const vendor = makeVendorSource(ingest);
	const vendorScheduler = makeCaptureScheduler({
		captureOnce: vendor.poller.pollOnce,
		immediate: true,
		intervalMs: vendor.intervalMs,
		mode: 'interval',
		onError: (error) => console.error('[vendor] poll error', error),
		onSkip: () => console.warn('[vendor] poll skipped — previous still in flight'),
	});
	vendorScheduler.start();
	console.log(`[vendor] Chameleon polling every ${vendor.intervalMs}ms.`);

	// Web view: state per source, recent alerts, last frame, manual capture button,
	// editable DDHQ queries.
	const web = makeWebServer({
		getCadence: airScheduler.getConfig,
		getLastFrame: airSource.getLastFrame,
		getRecentAlerts: () => recentAlerts,
		matchStore: airSource.matchStore,
		onRaceRelink: applyRelink,
		raceIdentity,
		reconcileRace: composition.reconcileRace,
		setCadence: airScheduler.reconfigure,
		store: composition.store,
		triggerCapture: airScheduler.triggerCapture,
		...(queryStore === undefined ? {} : { queryStore }),
	});
	const webPort = Number(process.env.WEB_PORT) || 8787;

	let shuttingDown = false;
	const shutdown = (): void => {
		if (shuttingDown) return;
		shuttingDown = true;
		airScheduler.stop();
		providerScheduler?.stop();
		vendorScheduler.stop();
		void airSource.close();
		void web.close();
		recorder.close();
		settings.close();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	airScheduler.start();
	await web.listen({ port: webPort });
	console.log(
		`[live] session ${sessionId} ready · air mode=${mode}${mode === 'interval' ? ` every ${intervalMs}ms` : ' (manual)'} · web http://localhost:${webPort}`,
	);
};

if (import.meta.url === `file://${process.argv[1]}`) {
	liveMain().catch((error: unknown) => {
		console.error('[live] fatal', error);
		process.exit(1);
	});
}

export default liveMain;
