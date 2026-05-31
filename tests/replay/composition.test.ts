import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CandidateState, RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';

import makePlayer from '../../src/replay/player.js';
import makeRecorder from '../../src/replay/recorder.js';
import makeComposition from '../../src/runtime/composition.js';

const candidate = (key: string, name: string, votes: number): CandidateState => ({
	key,
	name,
	party: 'D',
	pct: 50,
	votes,
});

const observation = (
	source: SourceName,
	at: number,
	votes: number,
	options: { calledFor?: string } = {},
): RaceObservation => ({
	calledFor: options.calledFor === undefined ? [] : [options.calledFor],
	candidates: [candidate('A', 'Jane Smith', votes), candidate('B', 'John Doe', votes / 2)],
	observedAt: at,
	pctIn: 50,
	raceKey: 'TEST:RACE',
	reportedAt: at,
	source,
});

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-comp-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

describe('recorder → player → composition round-trip', () => {
	it('records via composition.onRecord, replays into a fresh composition, reconciles to the same anomalies', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'rt-1' });
		const liveComposition = makeComposition({
			onRecord: recorder.recordObservation,
		});

		liveComposition.store.record(observation('DDHQ', 1_000, 100));
		liveComposition.store.record(observation('air', 1_010, 100, { calledFor: 'A' }));
		recorder.close();

		const liveAnomalies = liveComposition.reconcileRace('TEST:RACE', 1_020);
		expect(liveAnomalies.length).toBeGreaterThan(0);

		const player = makePlayer({ baseDir, sessionId: 'rt-1' });
		const replayComposition = makeComposition();
		player.emitObservationsInto(replayComposition.store.record);
		player.close();

		const replayAnomalies = replayComposition.reconcileRace('TEST:RACE', 1_020);
		expect(replayAnomalies).toEqual(liveAnomalies);
	});
});
