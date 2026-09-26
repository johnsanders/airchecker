import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';

import makeRecorder from '../../src/replay/recorder.js';
import { runReplay } from '../../src/runtime/replayMain.js';

const observation = (source: SourceName, at: number, votes: number): RaceObservation => ({
	calledFor: [],
	candidates: [{ key: 'A', name: 'Ann Able', party: 'D', pct: 55, votes }],
	observedAt: at,
	pctIn: 50,
	raceKey: 'TX U.S. SENATE (D)',
	reportedAt: null,
	source,
	...(source === 'air' ? { templateId: 'ticker_v1' } : {}),
});

let baseDir: string;
beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-replay-'));
});
afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

describe('runReplay', () => {
	it('plays a recorded session through store, tracker and alert log with a recorded frame', async () => {
		const recorder = makeRecorder({ baseDir, sessionId: 's' });
		const t0 = 1_700_000_000_000;
		recorder.recordObservation(observation('Ross', t0, 1000));
		recorder.recordFrame({ png: Buffer.from('png-bytes'), ts: t0 + 8_000 });
		// Air disagrees with the vendor snapshot in the lag window → votes_mismatch.
		recorder.recordObservation(observation('air', t0 + 8_000, 999));
		recorder.close();

		const replay = runReplay({ baseDir, sessionId: 's' });
		await replay.done;

		expect(replay.composition.store.getRaceKeys()).toEqual(['TX U.S. SENATE (D)']);
		expect(replay.composition.store.getVendorHistory('TX U.S. SENATE (D)')).toHaveLength(1);
		const raised = replay.alertLog.recent().filter((event) => event.kind === 'raised');
		expect(raised.map((event) => event.type)).toEqual(['votes_mismatch']);
		expect(replay.tracker.list()).toHaveLength(1);
		// Timestamps are shifted to start "now" — observedAt is no longer the 2023 epoch.
		expect(replay.tracker.list()[0]!.observedAt).toBeGreaterThan(t0 + 365 * 24 * 3_600_000);
		const frame = replay.getLastFrame();
		expect(frame?.png.toString()).toBe('png-bytes');
		expect(frame?.observations.map((o) => o.source)).toEqual(['air']);
	});

	it('paces batches by wall clock at the requested speed', async () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'paced' });
		const t0 = 1_700_000_000_000;
		recorder.recordObservation(observation('Ross', t0, 1000));
		recorder.recordObservation(observation('Ross', t0 + 2_000, 1001));
		recorder.close();

		const started = Date.now();
		const replay = runReplay({ baseDir, sessionId: 'paced', speed: 100 }); // 2 s → 20 ms
		expect(replay.composition.store.getVendorHistory('TX U.S. SENATE (D)')).toHaveLength(1);
		await replay.done;
		expect(replay.composition.store.getVendorHistory('TX U.S. SENATE (D)')).toHaveLength(2);
		expect(Date.now() - started).toBeGreaterThanOrEqual(15);
	});
});
