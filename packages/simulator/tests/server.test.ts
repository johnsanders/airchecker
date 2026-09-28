import type { FastifyInstance } from 'fastify';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AirFeed } from '../src/air/airFeed.js';

import { makeApiPlayback } from '../src/playback/apiPlayback.js';
import { makeApiRecorder } from '../src/recording/apiRecorder.js';
import { openApiRecordingWriter } from '../src/recording/apiRecording.js';
import { makeSettingsStore } from '../src/settings.js';
import { makeWebServer } from '../src/web/server.js';

const CHAMELEON_PATH =
	'/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json&pretty=yes&dynFieldDefaultAttr=false';

const dirs: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
	await Promise.all(apps.splice(0).map((app) => app.close()));
	dirs.splice(0).forEach((dir) => rmSync(dir, { force: true, recursive: true }));
});

// One recorded night: two DDHQ polls a minute apart (the second paginated, the first
// failed), plus Chameleon's playlist and a query that only appears later.
const setup = () => {
	const baseDir = mkdtempSync(join(tmpdir(), 'elex-sim-server-'));
	dirs.push(baseDir);
	const writer = openApiRecordingWriter(baseDir, {
		ddhqQueries: ['state=TX'],
		name: 'night',
		startedAt: 0,
	});
	writer.append({
		body: null,
		error: 'HTTP 500 for x: boom',
		path: '/api/v4/races?state=TX',
		source: 'DDHQ',
		ts: 0,
	});
	writer.append({
		body: { contests: [1] },
		error: null,
		path: CHAMELEON_PATH,
		source: 'Ross',
		ts: 1_000,
	});
	writer.append({
		body: { page: 1 },
		error: null,
		path: '/api/v4/races?state=TX',
		source: 'DDHQ',
		ts: 60_000,
	});
	writer.append({
		body: { page: 2 },
		error: null,
		path: '/api/v4/races?state=TX&page=2',
		source: 'DDHQ',
		ts: 62_000,
	});
	writer.append({
		body: { late: true },
		error: null,
		path: '/api/v4/races?state=GA',
		source: 'DDHQ',
		ts: 600_000,
	});
	writer.close(600_000, ['state=TX', 'state=GA']);

	let wall = 0;
	const feedCalls: string[] = [];
	const airFeed: AirFeed = {
		pause: () => feedCalls.push('pause'),
		resume: () => feedCalls.push('resume'),
		start: (playback) => feedCalls.push(`start ${playback.recording.meta.name}`),
		stop: () => feedCalls.push('stop'),
	};
	const recorder = makeApiRecorder({ baseDir, getQueries: () => [] });
	const app = makeWebServer({
		playback: makeApiPlayback({ airFeed, baseDir, now: () => wall }),
		recorder,
		recordErrors: () => [],
		settings: makeSettingsStore(join(baseDir, 'settings.json')),
	});
	apps.push(app);
	return {
		app,
		feedCalls,
		setWall: (next: number) => {
			wall = next;
		},
	};
};

describe('mirror endpoints', () => {
	it('answers 503 until a recording plays, and always issues a token', async () => {
		const { app } = setup();
		const token = await app.inject({ method: 'POST', url: '/api/v4/oauth/token' });
		expect(token.json()).toMatchObject({ access_token: 'elex-sim' });
		const races = await app.inject({ method: 'GET', url: '/api/v4/races?state=TX' });
		expect(races.statusCode).toBe(503);
	});

	it('plays DDHQ pages and the Chameleon playlist back along the clock', async () => {
		const { app, feedCalls, setWall } = setup();
		const started = await app.inject({
			method: 'POST',
			payload: { name: 'night' },
			url: '/api/api-playback/start',
		});
		expect(started.json()).toMatchObject({
			playback: { ddhqQueries: ['state=TX', 'state=GA'], name: 'night', paused: false },
		});

		const first = await app.inject({ method: 'GET', url: '/api/v4/races?state=TX' });
		expect(first.statusCode).toBe(502);
		expect(first.body).toBe('HTTP 500 for x: boom');
		const playlist = await app.inject({ method: 'GET', url: CHAMELEON_PATH });
		expect(playlist.json()).toEqual({ contests: [1] });

		setWall(59_000);
		expect((await app.inject({ method: 'GET', url: '/api/v4/races?state=TX' })).json()).toEqual({
			page: 1,
		});
		expect(
			(await app.inject({ method: 'GET', url: '/api/v4/races?state=TX&page=2' })).json(),
		).toEqual({ page: 2 });

		const early = await app.inject({ method: 'GET', url: '/api/v4/races?state=GA' });
		expect(early.statusCode).toBe(404);
		expect(early.body).toMatch(/not recorded yet/);
		const never = await app.inject({ method: 'GET', url: '/api/v4/races?state=NY' });
		expect(never.statusCode).toBe(404);
		expect(never.body).toMatch(/was not recorded/);

		await app.inject({ method: 'POST', url: '/api/api-playback/pause' });
		await app.inject({ method: 'POST', url: '/api/api-playback/resume' });
		await app.inject({ method: 'POST', url: '/api/api-playback/restart' });
		expect((await app.inject({ method: 'GET', url: '/api/v4/races?state=TX' })).statusCode).toBe(
			502,
		);
		await app.inject({ method: 'POST', url: '/api/api-playback/stop' });
		expect((await app.inject({ method: 'GET', url: CHAMELEON_PATH })).statusCode).toBe(503);
		expect(feedCalls).toEqual(['start night', 'pause', 'resume', 'start night', 'stop']);
	});

	it('refuses to play an unknown recording or delete the one playing', async () => {
		const { app } = setup();
		const unknown = await app.inject({
			method: 'POST',
			payload: { name: 'nope' },
			url: '/api/api-playback/start',
		});
		expect(unknown.statusCode).toBe(404);
		await app.inject({
			method: 'POST',
			payload: { name: 'night' },
			url: '/api/api-playback/start',
		});
		const deleted = await app.inject({ method: 'DELETE', url: '/api/api-recordings/night' });
		expect(deleted.statusCode).toBe(409);
	});
});

describe('control API', () => {
	it('saves the recorder settings, trimmed, and rejects bad ones', async () => {
		const { app } = setup();
		const saved = await app.inject({
			method: 'POST',
			payload: { environment: 'integration', intervalSeconds: 15, queries: [' state=TX ', ''] },
			url: '/api/settings',
		});
		const expected = { environment: 'integration', intervalSeconds: 15, queries: ['state=TX'] };
		expect(saved.json()).toEqual(expected);
		expect((await app.inject({ method: 'GET', url: '/api/settings' })).json()).toEqual(expected);
		const statuses = await Promise.all(
			[
				{ environment: 'sim', intervalSeconds: 60, queries: [] },
				{ environment: 'production', intervalSeconds: 1, queries: [] },
				{ environment: 'production', intervalSeconds: 7.5, queries: [] },
				{ environment: 'production', queries: [] },
			].map(
				async (payload) =>
					(await app.inject({ method: 'POST', payload, url: '/api/settings' })).statusCode,
			),
		);
		expect(statuses).toEqual([400, 400, 400, 400]);
	});

	it('lists and browses recordings', async () => {
		const { app } = setup();
		const list = (await app.inject({ method: 'GET', url: '/api/api-recordings' })).json<{
			recordings: { name: string; responseCount: number }[];
		}>();
		expect(list.recordings).toMatchObject([{ name: 'night', responseCount: 5 }]);
		const responses = await app.inject({
			method: 'GET',
			url: '/api/api-recordings/night/responses?source=Ross',
		});
		expect(responses.json()).toMatchObject({ responses: [{ path: CHAMELEON_PATH, seq: 2 }] });
		const body = await app.inject({
			method: 'GET',
			url: '/api/api-recordings/night/responses/2/body',
		});
		expect(body.body).toBe('{"contests":[1]}');
	});
});
