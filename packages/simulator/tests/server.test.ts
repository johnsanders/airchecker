import type { FastifyInstance } from 'fastify';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { AirFeed } from '../src/air/airFeed.js';

import { makeAirShow } from '../src/air/airShow.js';
import { loadRaces } from '../src/air/races.js';
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
		airShow: makeAirShow({ now: () => wall, races: loadRaces('races.json'), randomSeed: () => 1 }),
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

describe('air feed', () => {
	it('is off until started, then airs the ticker and runs the night along the clock', async () => {
		const { app, setWall } = setup();
		expect((await app.inject({ method: 'GET', url: '/api/air/now' })).json()).toEqual({
			onAir: null,
		});
		const started = await app.inject({
			method: 'POST',
			payload: { durationMinutes: 30 },
			url: '/api/air/start',
		});
		expect(started.json()).toMatchObject({ air: { durationMs: 1_800_000, elapsedMs: 0, seed: 1 } });
		setWall(60_000);
		const now = (await app.inject({ method: 'GET', url: '/api/air/now' })).json<{
			onAir: { ticker: { data: { state: string } } };
		}>();
		expect(now.onAir.ticker.data.state).toMatch(/^[A-Z]{2}(-\d+)?$/);
		const status = (await app.inject({ method: 'GET', url: '/api/status' })).json();
		expect(status).toMatchObject({ air: { elapsedMs: 60_000 } });
		await app.inject({ method: 'POST', url: '/api/air/stop' });
		expect((await app.inject({ method: 'GET', url: '/api/status' })).json()).toMatchObject({
			air: null,
		});
		// The stopped night still answers for the time it was on air, and only then.
		const aired = async (ts: number) =>
			(await app.inject({ method: 'GET', url: `/api/air/aired?ts=${ts}` })).json<{
				onAir: unknown;
			}>().onAir;
		expect(await aired(59_999)).toMatchObject({ ticker: { raceKey: expect.any(String) } });
		expect(await aired(60_000)).toBeNull(); // stopped then
		expect((await app.inject({ method: 'GET', url: '/api/air/aired?ts=soon' })).statusCode).toBe(
			400,
		);
	});

	it('serves the running night on the mirrors, taking over from playback and back', async () => {
		const { app } = setup();
		const get = (url: string) => app.inject({ method: 'GET', url });
		await app.inject({
			method: 'POST',
			payload: { name: 'night' },
			url: '/api/api-playback/start',
		});
		expect((await get('/api/sim/queries')).json()).toEqual({ queries: ['state=TX', 'state=GA'] });

		await app.inject({ method: 'POST', payload: { durationMinutes: 30 }, url: '/api/air/start' });
		expect((await get('/api/status')).json()).toMatchObject({ playback: null });
		const queries = (await get('/api/sim/queries')).json<{ queries: string[] }>().queries;
		expect(queries).toHaveLength(3);
		const races = (await get(`/api/v4/races?${queries[0] ?? ''}`)).json<{ data: unknown[] }>();
		expect(races.data).toHaveLength(50);
		const playlist = (await get(CHAMELEON_PATH)).json<{
			ElectionPlaylist: { contest: unknown[] };
		}>();
		expect(playlist.ElectionPlaylist.contest).toHaveLength(116);
		expect((await get('/api/v4/elections')).statusCode).toBe(404);

		await app.inject({
			method: 'POST',
			payload: { name: 'night' },
			url: '/api/api-playback/start',
		});
		expect((await get('/api/status')).json()).toMatchObject({ air: null });
		expect((await get(CHAMELEON_PATH)).json()).toEqual({ contests: [1] });
	});

	it('rejects a bad duration', async () => {
		const { app } = setup();
		const statuses = await Promise.all(
			[{}, { durationMinutes: 0 }, { durationMinutes: 'ten' }, { durationMinutes: 601 }].map(
				async (payload) =>
					(await app.inject({ method: 'POST', payload, url: '/api/air/start' })).statusCode,
			),
		);
		expect(statuses).toEqual([400, 400, 400, 400]);
	});

	it('serves the air page and its graphics, and nothing else from the package', async () => {
		const { app } = setup();
		const get = async (url: string) => {
			const response = await app.inject({ method: 'GET', url });
			return { body: response.body, statusCode: response.statusCode };
		};
		expect((await get('/air')).statusCode).toBe(302);
		expect((await get('/air/')).body).toContain('Simulated air');
		expect((await get('/air/ticker.html')).body).toContain('renderGraphic');
		expect((await get('/air/fullscreen-assets/background.png')).statusCode).toBe(200);
		// Anything else falls through to the SPA (when built) or a 404, never the file.
		expect((await get('/air/races.json')).body).not.toContain('ddhqRaceId');
		expect((await get('/air/package.json')).body).not.toContain('"simulator"');
		expect((await get('/air/../package.json')).body).not.toContain('"simulator"');
	});
});
