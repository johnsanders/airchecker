import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { SessionGoldenDoc } from '../../src/replay/sessionGolden.js';

import { replaySessionTimeline } from '../../src/replay/sessionGolden.js';

const here = dirname(fileURLToPath(import.meta.url));
const sessionsDir = resolve(here, '..', '..', 'recordings', 'goldens', 'sessions');

const goldenFiles = existsSync(sessionsDir)
	? readdirSync(sessionsDir).filter((file) => file.endsWith('.session.json'))
	: [];

describe('session golden replays', () => {
	it('has at least one session golden to replay', () => {
		expect(goldenFiles.length).toBeGreaterThan(0);
	});

	goldenFiles.forEach((file) => {
		it(`replays ${file} deterministically with no API key`, () => {
			const doc = JSON.parse(readFileSync(join(sessionsDir, file), 'utf8')) as SessionGoldenDoc;

			expect(replaySessionTimeline(doc.observations)).toEqual(doc.expected);
		});
	});
});
