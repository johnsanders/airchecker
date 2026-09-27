import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RaceIdentityResolver } from '../identity/raceIdentity.js';
import type { RaceObservation } from '../reconcile/reconcile.js';
import type { ChangeBus } from '../web/changeBus.js';
import type { LastFrameView } from '../web/server.js';
import type { AlertLog } from './alertLog.js';
import type { AnomalyTracker } from './anomalyTracker.js';
import type { Composition } from './composition.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import makePlayer from '../replay/player.js';
import { makeSessionFiles } from '../replay/sessionFiles.js';
import { buildTimeline } from '../replay/sessionGolden.js';
import { makeChangeBus } from '../web/changeBus.js';
import { makeWebServer } from '../web/server.js';
import { makeAlertLog } from './alertLog.js';
import { makeAnomalyTracker } from './anomalyTracker.js';
import makeComposition from './composition.js';

// Replays a recorded session through the live pipeline — store, identity rekeys,
// reconciler, tracker, alert log — either instantly (the default; then prints what
// stands) or paced in wall-clock time behind the real web view (`--serve`), so the
// operator flow can be rehearsed on a past broadcast with no sources and no key.
//
//   node --import tsx src/runtime/replayMain.ts <sessionId> [--serve] [--port=8787] [--speed=N]
//
// Timestamps are shifted by a constant so the session starts "now": lag windows
// keep their real widths, and at --speed=1 the view reads exactly as it did live.
// At higher speeds the data runs ahead of the clock (the view shows "0s ago").

export type ReplayHandles = {
	alertLog: AlertLog;
	changeBus: ChangeBus;
	composition: Composition;
	done: Promise<void>;
	getLastFrame: () => LastFrameView | undefined;
	raceIdentity: RaceIdentityResolver;
	tracker: AnomalyTracker;
};

export type ReplayOptions = {
	baseDir?: string;
	sessionId: string;
	speed?: 'max' | number; // default 'max' (instant)
};

export const runReplay = (options: ReplayOptions): ReplayHandles => {
	const baseDir = options.baseDir ?? 'recordings';
	const speed = options.speed ?? 'max';
	const player = makePlayer({ baseDir, sessionId: options.sessionId });
	const observations = player.readObservations();
	const identityEvents = player.readIdentityEvents();
	const frames = player.readFrames();
	player.close();

	const composition = makeComposition();
	const tracker = makeAnomalyTracker(composition.thresholds);
	const alertLog = makeAlertLog();
	const changeBus = makeChangeBus();
	const raceIdentity = makeRaceIdentityResolver();
	let lastFrame: LastFrameView | undefined;

	const timeline = buildTimeline({ identityEvents, observations });
	const firstTs = timeline[0]?.ts ?? Date.now();
	const shift = Date.now() - firstTs;

	const reconcileKeys = (raceKeys: string[], now: number): void => {
		const events = Array.from(new Set(raceKeys)).flatMap((raceKey) =>
			alertLog.record(tracker.update(raceKey, composition.reconcileRace(raceKey, now)), now),
		);
		changeBus.broadcast({
			raceKeys: events.length > 0 ? events.map((event) => event.raceKey) : raceKeys,
			type: 'changed',
		});
	};

	// The frame that produced an air batch: the last recorded frame at or before it.
	const frameFor = (originalTs: number, airObservations: RaceObservation[]): void => {
		const frame = frames.filter((row) => row.ts <= originalTs).at(-1);
		if (frame === undefined) return;
		const path = join(baseDir, frame.path);
		if (!existsSync(path)) return;
		lastFrame = {
			hash: frame.frameHash,
			observations: airObservations,
			png: readFileSync(path),
			ts: originalTs + shift,
		};
	};

	const apply = (item: (typeof timeline)[number]): void => {
		if (item.kind === 'batch') {
			const shifted = item.batch.observations.map((observation) => ({
				...observation,
				observedAt: observation.observedAt + shift,
			}));
			shifted.forEach(composition.store.record);
			const air = shifted.filter((observation) => observation.source === 'air');
			if (air.length > 0) frameFor(item.batch.ts, air);
			reconcileKeys(
				shifted.map((observation) => observation.raceKey),
				item.batch.ts + shift,
			);
			return;
		}
		raceIdentity.applyEvent(item.event.event);
		if (item.event.event.type !== 'alias_upsert') return;
		const result = composition.store.rekeySourceRace(
			item.event.event.payload.source,
			item.event.event.payload.sourceRaceKey,
			item.event.event.payload.canonicalRaceKey,
		);
		if (result.fromRaceKeys.length === 0) return;
		reconcileKeys([...result.fromRaceKeys, result.toRaceKey], item.event.ts + shift);
	};

	const done =
		speed === 'max'
			? Promise.resolve(timeline.forEach(apply))
			: new Promise<void>((resolve) => {
					const step = (index: number): void => {
						const item = timeline[index];
						if (item === undefined) {
							resolve();
							return;
						}
						apply(item);
						const next = timeline[index + 1];
						if (next === undefined) {
							resolve();
							return;
						}
						setTimeout(() => step(index + 1), Math.max(0, (next.ts - item.ts) / speed));
					};
					step(0);
				});

	return {
		alertLog,
		changeBus,
		composition,
		done,
		getLastFrame: () => lastFrame,
		raceIdentity,
		tracker,
	};
};

const flag = (name: string): string | undefined =>
	process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const main = async (): Promise<void> => {
	const sessionId = process.argv[2];
	if (sessionId === undefined || sessionId.startsWith('--')) {
		console.error(
			'usage: node --import tsx src/runtime/replayMain.ts <sessionId> [--serve] [--port=8787] [--speed=N]',
		);
		process.exit(1);
	}
	const serve = process.argv.includes('--serve');
	const speedFlag = flag('speed');
	const speed = speedFlag === undefined ? (serve ? 1 : 'max') : Number(speedFlag);
	const port = Number(flag('port') ?? process.env.WEB_PORT) || 8787;

	const replay = runReplay({ sessionId, speed });

	if (serve) {
		const web = makeWebServer({
			changeBus: replay.changeBus,
			getAlertHistory: replay.alertLog.recent,
			getLastFrame: replay.getLastFrame,
			getRecentAlerts: replay.tracker.list,
			raceIdentity: replay.raceIdentity,
			reconcileRace: replay.composition.reconcileRace,
			sessions: makeSessionFiles('recordings', sessionId),
			store: replay.composition.store,
		});
		await web.listen({ port });
		console.log(
			`[replay] ${sessionId} playing at ${speed}× · web http://localhost:${port} (Ctrl-C to stop)`,
		);
		process.on('SIGINT', () => {
			void web.close();
			process.exit(0);
		});
		await replay.done;
		console.log('[replay] session finished; still serving the final state');
		return;
	}

	await replay.done;
	const raceKeys = replay.composition.store.getRaceKeys();
	const standing = replay.tracker.list();
	const events = replay.alertLog.recent(Number.MAX_SAFE_INTEGER);
	console.log(
		`[replay] ${sessionId}: ${raceKeys.length} race(s), ${events.filter((e) => e.kind === 'raised').length} raised / ${events.filter((e) => e.kind === 'cleared').length} cleared, ${standing.length} standing`,
	);
	standing.forEach((anomaly) => {
		console.log(`  [${anomaly.severity}] ${anomaly.type} ${anomaly.raceKey} — ${anomaly.detail}`);
	});
};

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error: unknown) => {
		console.error('[replay] fatal', error);
		process.exit(1);
	});
}
