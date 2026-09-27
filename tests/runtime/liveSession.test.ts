import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';

import { makeSessionFiles } from '../../src/replay/sessionFiles.js';
import { makeLiveSession } from '../../src/runtime/liveSession.js';

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-live-session-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

const observation: RaceObservation = {
	calledFor: [],
	candidates: [],
	observedAt: 1,
	pctIn: 0,
	raceKey: 'R1',
	reportedAt: null,
	source: 'DDHQ',
};

describe('liveSession', () => {
	it('opens a new session on each start, closes it on stop, and drops writes while stopped', () => {
		const calls: string[] = [];
		const session = makeLiveSession({
			baseDir,
			onStart: () => calls.push('start'),
			onStop: () => calls.push('stop'),
		});
		const files = makeSessionFiles(baseDir, session.currentId);

		const first = session.start();
		expect(first.running).toBe(true);
		session.recorder.recordObservation(observation);
		expect(session.start().id).toBe(first.id); // already running: no second session
		expect(session.stop()).toEqual({ id: null, running: false, startedAt: null });

		// A poll that lands after stop has nowhere to go.
		session.recorder.recordObservation(observation);
		expect(session.recorder.recordFrame({ png: Buffer.from('frame'), ts: 2 })).toMatch(
			/^[0-9a-f]{64}$/,
		);

		const second = session.start();
		expect(second.id).not.toBe(first.id);
		session.recorder.recordObservation(observation);
		session.recorder.recordObservation(observation);
		session.stop();

		expect(calls).toEqual(['start', 'stop', 'start', 'stop']);
		const summaries = files.list();
		expect(
			summaries.map((summary) => [
				summary.id,
				summary.observations,
				summary.endedAt !== null,
				summary.current,
			]),
		).toEqual([
			[first.id, 1, true, false],
			[second.id, 2, true, false],
		]);
	});
});
