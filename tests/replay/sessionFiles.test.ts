import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import makeRecorder from '../../src/replay/recorder.js';
import { makeSessionFiles } from '../../src/replay/sessionFiles.js';

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-sessions-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

const recordSession = (sessionId: string): void => {
	const recorder = makeRecorder({ baseDir, sessionId });
	recorder.recordObservation({
		calledFor: [],
		candidates: [],
		observedAt: 1,
		pctIn: 0,
		raceKey: 'R1',
		reportedAt: null,
		source: 'DDHQ',
	});
	recorder.recordFrame({ png: Buffer.from('not really a png'), ts: 1 });
	recorder.close();
};

describe('sessionFiles', () => {
	it('lists sessions with row counts and sizes, skipping settings.sqlite', () => {
		recordSession('old');
		recordSession('live');
		makeRecorder({ baseDir, sessionId: 'settings' }).close();
		const sessions = makeSessionFiles(baseDir, 'live').list();
		expect(sessions.map((session) => [session.id, session.current])).toEqual([
			['live', true],
			['old', false],
		]);
		expect(sessions[1]).toMatchObject({ alerts: 0, frames: 1, framesBytes: 16, observations: 1 });
		expect(sessions[1]?.startedAt).toBeTypeOf('number');
	});

	it('prunes frames but keeps the sqlite', () => {
		recordSession('old');
		const files = makeSessionFiles(baseDir);
		expect(files.pruneFrames('old')).toBe(16);
		expect(existsSync(join(baseDir, 'old', 'frames'))).toBe(false);
		expect(files.list()[0]).toMatchObject({ frames: 1, framesBytes: 0, id: 'old' });
	});

	it('deletes a session: sqlite, side files and folder', () => {
		recordSession('old');
		recordSession('keep');
		const files = makeSessionFiles(baseDir);
		expect(files.deleteSession('old')).toBeGreaterThan(16);
		expect(existsSync(join(baseDir, 'old.sqlite'))).toBe(false);
		expect(existsSync(join(baseDir, 'old'))).toBe(false);
		expect(files.list().map((session) => session.id)).toEqual(['keep']);
	});

	it('refuses the session being recorded and unknown ids', () => {
		recordSession('live');
		const files = makeSessionFiles(baseDir, 'live');
		expect(() => files.pruneFrames('live')).toThrow(/being recorded/);
		expect(() => files.pruneFrames('../live')).toThrow(/no session/);
		expect(() => files.deleteSession('live')).toThrow(/being recorded/);
		expect(() => files.deleteSession('../live')).toThrow(/no session/);
		expect(existsSync(join(baseDir, 'live.sqlite'))).toBe(true);
		expect(existsSync(join(baseDir, 'live', 'frames'))).toBe(true);
	});

	it('reports disk space', () => {
		const disk = makeSessionFiles(baseDir).disk();
		expect(disk.freeBytes).toBeGreaterThan(0);
		expect(disk.totalBytes).toBeGreaterThanOrEqual(disk.freeBytes);
	});
});
