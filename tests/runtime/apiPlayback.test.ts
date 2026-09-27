import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { openApiRecordingWriter } from '../../src/replay/apiRecording.js';
import { makeApiPlayback } from '../../src/runtime/apiPlayback.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true })));

const withNight = (): string => {
	const baseDir = mkdtempSync(join(tmpdir(), 'api-playback-'));
	dirs.push(baseDir);
	const writer = openApiRecordingWriter(baseDir, {
		ddhqQueries: ['state=TX'],
		name: 'night',
		startedAt: 0,
	});
	writer.append({ body: { n: 1 }, error: null, path: '/p', source: 'Ross', ts: 0 });
	writer.append({ body: { n: 2 }, error: null, path: '/p', source: 'Ross', ts: 60_000 });
	writer.close(60_000, ['state=TX']);
	return baseDir;
};

describe('makeApiPlayback', () => {
	it('swaps in a recording, steers its clock, and reports each run', async () => {
		let wall = 0;
		const runs: (number | undefined)[] = [];
		const playback = makeApiPlayback({
			baseDir: withNight(),
			now: () => wall,
			onRun: (speed) => runs.push(speed),
		});
		expect(playback.status()).toBeUndefined();
		expect(playback.http('Ross')).toBeUndefined();
		expect(() => playback.start('../settings', 1)).toThrow(/no API recording named/);

		playback.start('night', 2);
		expect(playback.queries()).toEqual(['state=TX']);
		expect(await playback.http('Ross')?.getJson('http://h/p')).toEqual({ n: 1 });
		wall = 30_000;
		expect(await playback.http('Ross')?.getJson('http://h/p')).toEqual({ n: 2 });
		expect(playback.status()).toMatchObject({
			ended: false,
			name: 'night',
			paused: false,
			speed: 2,
		});

		playback.pause();
		expect(playback.status()).toMatchObject({ paused: true });
		playback.resume();
		playback.restart();
		expect(await playback.http('Ross')?.getJson('http://h/p')).toEqual({ n: 1 });

		playback.stop();
		expect(playback.status()).toBeUndefined();
		expect(playback.queries()).toBeUndefined();
		expect(runs).toEqual([2, 2, undefined]);
	});
});
