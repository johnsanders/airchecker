import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RaceObservation } from '../reconcile/reconcile.js';
import type { ChangeBus } from '../web/changeBus.js';
import type { LastFrameView } from '../web/server.js';
import type { Composition } from './composition.js';

import makePlayer from '../replay/player.js';
import { makeSessionFiles } from '../replay/sessionFiles.js';
import { batchByObservedAt } from '../replay/sessionGolden.js';
import { makeChangeBus } from '../web/changeBus.js';
import { makeWebServer } from '../web/server.js';
import makeComposition from './composition.js';

// Replays a recorded session through the live pipeline (composition.ts), either instantly
// (the default; then prints what stands) or paced in wall-clock time behind the real web
// view (`--serve`), so the operator flow can be rehearsed on a past broadcast with no
// sources and no key.
//
//   node --import tsx src/runtime/replayMain.ts <sessionId> [--serve] [--port=8787] [--speed=N]
//
// Timestamps are shifted by a constant so the session starts "now": lag windows
// keep their real widths, and at --speed=1 the view reads exactly as it did live.
// At higher speeds the data runs ahead of the clock (the view shows "0s ago").

export type ReplayHandles = {
	changeBus: ChangeBus;
	composition: Composition;
	done: Promise<void>;
	getLastFrame: () => LastFrameView | undefined;
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
	const batches = batchByObservedAt(player.readObservations());
	const frames = player.readFrames();
	player.close();

	const composition = makeComposition();
	const changeBus = makeChangeBus();
	let lastFrame: LastFrameView | undefined;

	const shift = Date.now() - (batches[0]?.ts ?? Date.now());

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

	const apply = (batch: (typeof batches)[number]): void => {
		const ingested = composition.ingest(
			batch.observations.map((observation) => ({
				...observation,
				observedAt: observation.observedAt + shift,
			})),
		);
		const air = ingested.observations.filter((observation) => observation.source === 'air');
		if (air.length > 0) frameFor(batch.ts, air);
		changeBus.broadcast({
			raceKeys: ingested.observations.map((observation) => observation.raceKey),
			type: 'changed',
		});
	};

	const done =
		speed === 'max'
			? Promise.resolve(batches.forEach(apply))
			: new Promise<void>((resolve) => {
					const step = (index: number): void => {
						const batch = batches[index];
						if (batch === undefined) {
							resolve();
							return;
						}
						apply(batch);
						const next = batches[index + 1];
						if (next === undefined) {
							resolve();
							return;
						}
						setTimeout(() => step(index + 1), Math.max(0, (next.ts - batch.ts) / speed));
					};
					step(0);
				});

	return { changeBus, composition, done, getLastFrame: () => lastFrame };
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
			composition: replay.composition,
			getLastFrame: replay.getLastFrame,
			sessions: makeSessionFiles('recordings', () => sessionId),
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
	const standing = replay.composition.latestReads().flatMap((checked) => checked.anomalies);
	const events = replay.composition.alertLog.recent(Number.MAX_SAFE_INTEGER);
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
