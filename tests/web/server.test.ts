import type { FastifyInstance } from 'fastify';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';
import type { ApiRecorderStatus } from '../../src/runtime/apiRecorder.js';

import { makeRaceIdentityResolver } from '../../src/identity/raceIdentity.js';
import { makeMatchStore } from '../../src/sources/air/matchStore.js';
import { makeQueryStore } from '../../src/sources/provider/queryStore.js';
import makeStore from '../../src/store/store.js';
import { makeWebServer } from '../../src/web/server.js';

type CandIn = { key: string; name: string; pct?: number; votes?: number };
const obs = (
	source: RaceObservation['source'],
	raceKey: string,
	opts: { calledFor?: string[]; candidates?: CandIn[]; pctIn?: number } = {},
): RaceObservation => ({
	calledFor: opts.calledFor ?? [],
	candidates: (opts.candidates ?? []).map((c) => ({
		key: c.key,
		name: c.name,
		party: 'D',
		pct: c.pct ?? 0,
		votes: c.votes ?? 0,
	})),
	observedAt: 1_700_000_000_000,
	pctIn: opts.pctIn ?? 0,
	raceKey,
	reportedAt: null,
	source,
});

let app: FastifyInstance | undefined;
afterEach(async () => {
	await app?.close();
	app = undefined;
});

describe('web server', () => {
	it('reports per-source state', async () => {
		const store = makeStore();
		store.record(obs('DDHQ', 'R1'));
		store.record(obs('air', 'R1'));
		app = makeWebServer({ getRecentAlerts: () => [], store });
		const res = await app.inject({ method: 'GET', url: '/api/state' });
		const body = res.json() as {
			sources: { observations: number; races: number; source: string }[];
		};
		const ddhq = body.sources.find((s) => s.source === 'DDHQ')!;
		const air = body.sources.find((s) => s.source === 'air')!;
		const ross = body.sources.find((s) => s.source === 'Ross')!;
		expect(ddhq.observations).toBe(1);
		expect(air.observations).toBe(1);
		expect(ross.observations).toBe(0);
	});

	it('returns recent alerts newest-first', async () => {
		const alerts: Anomaly[] = [
			{
				detail: 'a',
				involves: {},
				observedAt: 1,
				owner: 'us',
				raceKey: 'R',
				severity: 'low',
				type: 'vote_drop',
			},
			{
				detail: 'b',
				involves: {},
				observedAt: 2,
				owner: 'us',
				raceKey: 'R',
				severity: 'high',
				type: 'premature_call',
			},
		];
		app = makeWebServer({ getRecentAlerts: () => alerts, store: makeStore() });
		const res = await app.inject({ method: 'GET', url: '/api/state' });
		const body = res.json() as { alerts: { detail: string }[] };
		expect(body.alerts.map((a) => a.detail)).toEqual(['b', 'a']);
	});

	it('serves alert history newest-first with a bounded limit', async () => {
		const events = [20, 10].map((ts) => ({
			detail: 'd',
			kind: 'raised' as const,
			owner: 'us' as const,
			raceKey: 'r',
			severity: 'high' as const,
			ts,
			type: 'votes_mismatch' as const,
		}));
		app = makeWebServer({
			getAlertHistory: (limit) => events.slice(0, limit),
			getRecentAlerts: () => [],
			store: makeStore(),
		});
		const all = await app.inject({ method: 'GET', url: '/api/alert-history' });
		expect((all.json() as { events: { ts: number }[] }).events.map((e) => e.ts)).toEqual([20, 10]);
		const one = await app.inject({ method: 'GET', url: '/api/alert-history?limit=1' });
		expect((one.json() as { events: { ts: number }[] }).events.map((e) => e.ts)).toEqual([20]);
		const unwired = makeWebServer({ getRecentAlerts: () => [], store: makeStore() });
		expect((await unwired.inject({ method: 'GET', url: '/api/alert-history' })).json()).toEqual({
			events: [],
		});
		await unwired.close();
	});

	it('gets and sets DDHQ queries', async () => {
		const queryStore = makeQueryStore();
		app = makeWebServer({ getRecentAlerts: () => [], queryStore, store: makeStore() });

		expect((await app.inject({ method: 'GET', url: '/api/queries' })).json()).toEqual({
			queries: [],
		});

		const post = await app.inject({
			method: 'POST',
			payload: { queries: ['race_ids=1', '  ', 'state=TX'] },
			url: '/api/queries',
		});
		expect(post.json()).toEqual({ queries: ['race_ids=1', 'state=TX'] });
		expect(queryStore.get()).toEqual(['race_ids=1', 'state=TX']);
	});

	it('rejects malformed query payloads', async () => {
		app = makeWebServer({
			getRecentAlerts: () => [],
			queryStore: makeQueryStore(),
			store: makeStore(),
		});
		const res = await app.inject({
			method: 'POST',
			payload: { queries: 'nope' },
			url: '/api/queries',
		});
		expect(res.statusCode).toBe(400);
	});

	it('triggers a manual capture and reports the result', async () => {
		let captures = 0;
		app = makeWebServer({
			getRecentAlerts: () => [],
			store: makeStore(),
			triggerCapture: async () => {
				captures += 1;
				return { status: 'ran' };
			},
		});
		const res = await app.inject({ method: 'POST', url: '/api/capture' });
		expect(res.json()).toEqual({ ran: true, status: 'ran' });
		expect(captures).toBe(1);
	});

	it('reports a failed capture honestly (500 + message), not ran:true', async () => {
		app = makeWebServer({
			getRecentAlerts: () => [],
			store: makeStore(),
			triggerCapture: async () => ({ message: 'no browser', status: 'error' }),
		});
		const res = await app.inject({ method: 'POST', url: '/api/capture' });
		expect(res.statusCode).toBe(500);
		expect(res.json()).toMatchObject({ error: 'no browser', ran: false });
	});

	it('starts and stops the session, and refuses a manual capture while stopped', async () => {
		let running = true;
		const status = () => ({
			id: running ? 'live-1' : null,
			running,
			startedAt: running ? 1 : null,
		});
		app = makeWebServer({
			getRecentAlerts: () => [],
			session: {
				start: () => {
					running = true;
					return status();
				},
				status,
				stop: () => {
					running = false;
					return status();
				},
			},
			store: makeStore(),
			triggerCapture: async () => ({ status: 'ran' }),
		});
		const stopped = await app.inject({ method: 'POST', url: '/api/session/stop' });
		expect(stopped.json()).toEqual({ id: null, running: false, startedAt: null });
		const state = await app.inject({ method: 'GET', url: '/api/state' });
		expect(state.json()).toMatchObject({ session: { running: false } });
		const capture = await app.inject({ method: 'POST', url: '/api/capture' });
		expect(capture.statusCode).toBe(409);
		const started = await app.inject({ method: 'POST', url: '/api/session/start' });
		expect(started.json()).toEqual({ id: 'live-1', running: true, startedAt: 1 });
	});

	it('serves the last frame PNG', async () => {
		const png = Buffer.from('\x89PNG fake');
		app = makeWebServer({
			getLastFrame: () => ({ hash: 'h', observations: [], png, ts: 5 }),
			getRecentAlerts: () => [],
			store: makeStore(),
		});
		const res = await app.inject({ method: 'GET', url: '/api/last-frame' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('image/png');
		expect(res.rawPayload.equals(png)).toBe(true);
	});

	it('exposes the last frame observations in /api/state', async () => {
		const airObs = { ...obs('air', 'TX-SEN'), templateId: 'ticker_v1' };
		app = makeWebServer({
			getLastFrame: () => ({ hash: 'h', observations: [airObs], png: Buffer.from('x'), ts: 9 }),
			getRecentAlerts: () => [],
			store: makeStore(),
		});
		const res = await app.inject({ method: 'GET', url: '/api/state' });
		const body = res.json() as { lastFrame: { observations: { raceKey: string }[]; ts: number } };
		expect(body.lastFrame.ts).toBe(9);
		expect(body.lastFrame.observations[0]!.raceKey).toBe('TX-SEN');
	});

	it('serves a fallback page at / when the SPA is not built', async () => {
		app = makeWebServer({ getRecentAlerts: () => [], store: makeStore() });
		const res = await app.inject({ method: 'GET', url: '/' });
		expect(res.headers['content-type']).toContain('text/html');
		expect(res.body).toContain('Eagle Eye');
	});

	it('lists races with per-source summaries and alert count', async () => {
		const store = makeStore();
		store.record(
			obs('DDHQ', 'TX-SEN', {
				calledFor: ['p1'],
				candidates: [
					{ key: 'p2', name: 'Allred', pct: 40, votes: 50 },
					{ key: 'p1', name: 'Paxton', pct: 60, votes: 100 },
				],
				pctIn: 80,
			}),
		);
		store.record(obs('air', 'TX-SEN'));
		store.record(obs('Ross', 'GA-HOUSE'));
		app = makeWebServer({
			getRecentAlerts: () => [],
			reconcileRace: (raceKey) => (raceKey === 'TX-SEN' ? [{} as Anomaly] : []),
			store,
		});
		const body = (await app.inject({ method: 'GET', url: '/api/races' })).json() as {
			races: {
				alertCount: number;
				raceKey: string;
				sources: Record<
					string,
					{
						candidates: { called: boolean; name: string }[];
						pctIn: null | number;
						present: boolean;
					}
				>;
			}[];
		};
		const tx = body.races.find((r) => r.raceKey === 'TX-SEN')!;
		expect(tx.sources.DDHQ!.present).toBe(true);
		expect(tx.sources.air!.present).toBe(true);
		expect(tx.sources.Ross!.present).toBe(false);
		expect(tx.sources.DDHQ!.pctIn).toBe(80);
		expect(tx.alertCount).toBe(1);
		// Candidates ranked by votes desc, with the called flag set on the winner.
		expect(tx.sources.DDHQ!.candidates.map((c) => c.name)).toEqual(['Paxton', 'Allred']);
		expect(tx.sources.DDHQ!.candidates[0]!.called).toBe(true);
		expect(tx.sources.DDHQ!.candidates[1]!.called).toBe(false);
		const ga = body.races.find((r) => r.raceKey === 'GA-HOUSE')!;
		expect(ga.sources.Ross!.present).toBe(true);
		expect(ga.sources.DDHQ!.present).toBe(false);
	});

	it('orders races by last air read; DDHQ/Ross updates never move a race', async () => {
		const store = makeStore();
		const at = (observation: RaceObservation, observedAt: number): RaceObservation => ({
			...observation,
			observedAt,
		});
		store.record(at(obs('air', 'EARLIER', { pctIn: 10 }), 1_000));
		store.record(at(obs('air', 'LATER', { pctIn: 10 }), 2_000));
		store.record(at(obs('DDHQ', 'EARLIER', { pctIn: 20 }), 3_000));
		store.record(at(obs('Ross', 'EARLIER', { pctIn: 30 }), 4_000));
		store.record(at(obs('DDHQ', 'NEVER-AIRED', { pctIn: 20 }), 5_000));
		app = makeWebServer({ getRecentAlerts: () => [], store });
		const body = (await app.inject({ method: 'GET', url: '/api/races' })).json() as {
			races: { lastAt: null | number; raceKey: string }[];
		};
		expect(body.races.map((race) => [race.raceKey, race.lastAt])).toEqual([
			['LATER', 2_000],
			['EARLIER', 1_000],
			['NEVER-AIRED', null],
		]);
	});

	it('aligns candidates across sources by normalized name in /api/race/:key', async () => {
		const store = makeStore();
		// Same candidate, different casing/source; air missed the call, DDHQ has it.
		store.record(
			obs('DDHQ', 'TX-SEN', {
				calledFor: ['p1'],
				candidates: [{ key: 'p1', name: 'Ken Paxton', pct: 63.8, votes: 885949 }],
			}),
		);
		store.record(
			obs('air', 'TX-SEN', {
				candidates: [{ key: 'air-a', name: 'KEN PAXTON', pct: 63.8, votes: 885950 }],
			}),
		);
		app = makeWebServer({ getRecentAlerts: () => [], reconcileRace: () => [], store });
		const body = (await app.inject({ method: 'GET', url: '/api/race/TX-SEN' })).json() as {
			candidates: { cells: Record<string, { called: boolean; votes: number }>; name: string }[];
		};
		expect(body.candidates).toHaveLength(1); // both sources collapse to one row
		const row = body.candidates[0]!;
		expect(row.cells.DDHQ!.votes).toBe(885949);
		expect(row.cells.air!.votes).toBe(885950);
		expect(row.cells.DDHQ!.called).toBe(true); // DDHQ called this candidate
		expect(row.cells.air!.called).toBe(false); // air did not
	});

	it('gets and sets cadence', async () => {
		let cadence: { intervalMs: number; mode: 'interval' | 'manual' } = {
			intervalMs: 5000,
			mode: 'interval',
		};
		app = makeWebServer({
			getCadence: () => cadence,
			getRecentAlerts: () => [],
			setCadence: (next) => {
				cadence = { ...cadence, ...next };
			},
			store: makeStore(),
		});
		expect((await app.inject({ method: 'GET', url: '/api/cadence' })).json()).toEqual({
			intervalMs: 5000,
			mode: 'interval',
		});
		const res = await app.inject({
			method: 'POST',
			payload: { intervalMs: 2000, mode: 'manual' },
			url: '/api/cadence',
		});
		expect(res.json()).toEqual({ intervalMs: 2000, mode: 'manual' });
	});

	it('gets and sets the air tab match', async () => {
		const matchStore = makeMatchStore('directv');
		app = makeWebServer({ getRecentAlerts: () => [], matchStore, store: makeStore() });

		expect((await app.inject({ method: 'GET', url: '/api/air-match' })).json()).toEqual({
			match: 'directv',
		});
		const res = await app.inject({
			method: 'POST',
			payload: { match: 'other-player' },
			url: '/api/air-match',
		});
		expect(res.json()).toEqual({ match: 'other-player' });
		expect(matchStore.get()).toBe('other-player');
		// Pushed with the state so the UI toggle always reflects the server's target.
		expect((await app.inject({ method: 'GET', url: '/api/state' })).json().airMatch).toBe(
			'other-player',
		);
	});

	it("reports each source's current failure in /api/state", async () => {
		app = makeWebServer({
			getRecentAlerts: () => [],
			getSourceError: (source) =>
				source === 'air' ? { count: 2, message: 'no open tab', since: 1_000 } : undefined,
			store: makeStore(),
		});
		const state = (await app.inject({ method: 'GET', url: '/api/state' })).json() as {
			sources: { error: unknown; source: string }[];
		};
		expect(state.sources.map((entry) => [entry.source, entry.error])).toEqual([
			['DDHQ', null],
			['Ross', null],
			['air', { count: 2, message: 'no open tab', since: 1_000 }],
		]);
	});

	it('rejects an empty air match', async () => {
		app = makeWebServer({
			getRecentAlerts: () => [],
			matchStore: makeMatchStore(),
			store: makeStore(),
		});
		const res = await app.inject({
			method: 'POST',
			payload: { match: '  ' },
			url: '/api/air-match',
		});
		expect(res.statusCode).toBe(400);
	});

	it('serves TEST videos and points capture at the player once one is opened', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'eagle-eye-videos-'));
		writeFileSync(join(dir, 'night.mp4'), 'fake video bytes');
		const opened: string[] = [];
		const matchStore = makeMatchStore('directv');
		app = makeWebServer({
			getRecentAlerts: () => [],
			matchStore,
			store: makeStore(),
			testVideos: { dir, open: (file) => Promise.resolve(void opened.push(file)) },
		});

		expect((await app.inject({ method: 'GET', url: '/api/test-videos' })).json()).toEqual({
			files: ['night.mp4'],
		});
		const player = await app.inject({ method: 'GET', url: '/test-player/night.mp4' });
		expect(player.headers['content-type']).toContain('text/html');
		expect(player.body).toContain('src="/test-video/night.mp4"');
		expect((await app.inject({ method: 'GET', url: '/test-video/night.mp4' })).body).toBe(
			'fake video bytes',
		);
		expect((await app.inject({ method: 'GET', url: '/test-player/other.mp4' })).statusCode).toBe(
			404,
		);

		const res = await app.inject({
			method: 'POST',
			payload: { file: 'night.mp4' },
			url: '/api/test-video',
		});
		expect(res.json()).toEqual({ match: '/test-player/' });
		expect(opened).toEqual(['night.mp4']);
		expect(matchStore.get()).toBe('/test-player/');
	});

	it('refuses to open a TEST video that is not in the directory', async () => {
		const matchStore = makeMatchStore('directv');
		app = makeWebServer({
			getRecentAlerts: () => [],
			matchStore,
			store: makeStore(),
			testVideos: {
				dir: mkdtempSync(join(tmpdir(), 'eagle-eye-videos-')),
				open: () => Promise.resolve(),
			},
		});
		const res = await app.inject({
			method: 'POST',
			payload: { file: '../settings.sqlite' },
			url: '/api/test-video',
		});
		expect(res.statusCode).toBe(400);
		expect(matchStore.get()).toBe('directv');
	});

	it('lists and manually updates race aliases', async () => {
		const raceIdentity = makeRaceIdentityResolver();
		await raceIdentity.resolveObservation(obs('DDHQ', 'DDHQ:RACE'));
		await raceIdentity.resolveObservation(obs('air', 'AIR HEADING'));
		const store = makeStore();
		store.record({ ...obs('air', 'provisional:air:AIR-HEADING'), sourceRaceKey: 'AIR HEADING' });
		let relinked: unknown;
		app = makeWebServer({
			getRecentAlerts: () => [],
			onRaceRelink: (source, sourceRaceKey, canonicalRaceKey) => {
				relinked = { canonicalRaceKey, source, sourceRaceKey };
			},
			raceIdentity,
			store,
		});

		const list = (await app.inject({ method: 'GET', url: '/api/race-links' })).json() as {
			aliases: { sourceRaceKey: string }[];
		};
		expect(list.aliases.some((alias) => alias.sourceRaceKey === 'AIR HEADING')).toBe(true);

		const post = await app.inject({
			method: 'POST',
			payload: { canonicalRaceKey: 'DDHQ:RACE', source: 'air', sourceRaceKey: 'AIR HEADING' },
			url: '/api/race-links/aliases',
		});
		expect(post.statusCode).toBe(200);
		expect(relinked).toEqual({
			canonicalRaceKey: 'DDHQ:RACE',
			source: 'air',
			sourceRaceKey: 'AIR HEADING',
		});
	});

	it('starts and stops an API recording and lists saved ones', async () => {
		let status: ApiRecorderStatus = { mode: 'live', recording: null };
		const names: (string | undefined)[] = [];
		app = makeWebServer({
			apiRecording: {
				list: () => [
					{
						file: 'recordings/api/a.sqlite',
						name: 'a',
						responseCount: 3,
						startedAt: 1,
						stoppedAt: 2,
					},
				],
				start: (name) => {
					names.push(name);
					if (status.mode === 'live' && status.recording !== null)
						throw new Error('already recording a');
					status = { mode: 'live', recording: { name: 'a', responseCount: 0, startedAt: 1 } };
					return status;
				},
				status: () => status,
				stop: () => {
					status = { mode: 'live', recording: null };
					return status;
				},
			},
			getRecentAlerts: () => [],
			store: makeStore(),
		});
		const started = await app.inject({
			method: 'POST',
			payload: { name: 'a' },
			url: '/api/api-recording/start',
		});
		expect(started.json()).toMatchObject({ recording: { name: 'a' } });
		expect(names).toEqual(['a']);
		const again = await app.inject({
			method: 'POST',
			payload: {},
			url: '/api/api-recording/start',
		});
		expect(again.statusCode).toBe(409);
		expect((await app.inject({ method: 'GET', url: '/api/api-recording' })).json()).toMatchObject({
			recording: { name: 'a' },
		});
		const stopped = await app.inject({
			method: 'POST',
			payload: {},
			url: '/api/api-recording/stop',
		});
		expect(stopped.json()).toEqual({ mode: 'live', recording: null });
		const list = await app.inject({ method: 'GET', url: '/api/api-recordings' });
		expect(list.json()).toMatchObject({ recordings: [{ name: 'a', responseCount: 3 }] });
	});

	it('in API playback, refuses recording and query edits', async () => {
		const queryStore = makeQueryStore(['state=TX']);
		app = makeWebServer({
			apiRecording: {
				list: () => [],
				status: () => ({
					durationMs: 60_000,
					elapsedMs: 0,
					ended: false,
					mode: 'playback',
					name: 'a',
					speed: 2,
				}),
			},
			getRecentAlerts: () => [],
			queryStore,
			store: makeStore(),
		});
		expect(
			(await app.inject({ method: 'POST', payload: {}, url: '/api/api-recording/start' }))
				.statusCode,
		).toBe(409);
		const edit = await app.inject({
			method: 'POST',
			payload: { queries: ['state=GA'] },
			url: '/api/queries',
		});
		expect(edit.statusCode).toBe(409);
		expect(queryStore.get()).toEqual(['state=TX']);
		expect((await app.inject({ method: 'GET', url: '/api/api-recording' })).json()).toMatchObject({
			mode: 'playback',
			speed: 2,
		});
	});

	it('lists sessions and maps prune and delete refusals to 409', async () => {
		app = makeWebServer({
			getRecentAlerts: () => [],
			sessions: {
				deleteSession: (id) => {
					if (id === 'live') throw new Error('session live is being recorded');
					return 99;
				},
				disk: () => ({ freeBytes: 5, totalBytes: 10 }),
				list: () => [],
				pruneFrames: (id) => {
					if (id === 'live') throw new Error('cannot prune the session being recorded');
					return 42;
				},
			},
			store: makeStore(),
		});
		expect((await app.inject({ method: 'GET', url: '/api/sessions' })).json()).toEqual({
			disk: { freeBytes: 5, totalBytes: 10 },
			sessions: [],
		});
		const refused = await app.inject({ method: 'POST', url: '/api/sessions/live/prune-frames' });
		expect(refused.statusCode).toBe(409);
		expect(
			(await app.inject({ method: 'POST', url: '/api/sessions/old/prune-frames' })).json(),
		).toEqual({ freedBytes: 42 });
		const refusedDelete = await app.inject({ method: 'DELETE', url: '/api/sessions/live' });
		expect(refusedDelete.statusCode).toBe(409);
		expect((await app.inject({ method: 'DELETE', url: '/api/sessions/old' })).json()).toEqual({
			freedBytes: 99,
		});
	});
});
