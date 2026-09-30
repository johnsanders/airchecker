import type { FastifyInstance } from 'fastify';

import { afterEach, describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';
import type { DdhqHost, Mode } from '../../src/sources/provider/providerSource.js';

import makeComposition from '../../src/runtime/composition.js';
import { makeMatchStore } from '../../src/sources/air/matchStore.js';
import { makeQueryStore } from '../../src/sources/provider/queryStore.js';
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

const TX_SENATE = '2026-TX-US_Senate-AL-NP-General_Election';

const ross = (observedAt: number, votes: number): RaceObservation => ({
	...obs('Ross', TX_SENATE, {
		calledFor: ['c1'],
		candidates: [{ key: 'c1', name: 'Ken Paxton', pct: 60, votes }],
		pctIn: 80,
	}),
	observedAt,
	providerRaceId: '77',
});

const air = (observedAt: number, votes: number): RaceObservation => ({
	...obs('air', 'TX U.S. SENATE', {
		calledFor: ['KEN PAXTON'],
		candidates: [{ key: 'KEN PAXTON', name: 'KEN PAXTON', pct: 60, votes }],
		pctIn: 80,
	}),
	observedAt,
	templateId: 'ticker_v1',
});

let app: FastifyInstance | undefined;
afterEach(async () => {
	await app?.close();
	app = undefined;
});

describe('web server', () => {
	it('reports per-source state', async () => {
		const composition = makeComposition();
		composition.ingest([obs('DDHQ', 'R1'), obs('air', 'R1')]);
		app = makeWebServer({ composition });
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

	it('gets and sets DDHQ queries', async () => {
		const queryStore = makeQueryStore();
		app = makeWebServer({ composition: makeComposition(), queryStore });

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
			composition: makeComposition(),
			queryStore: makeQueryStore(),
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
			composition: makeComposition(),
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
			composition: makeComposition(),
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
			composition: makeComposition(),
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
			composition: makeComposition(),
			getLastFrame: () => ({ hash: 'h', observations: [], png, ts: 5 }),
		});
		const res = await app.inject({ method: 'GET', url: '/api/last-frame' });
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toContain('image/png');
		expect(res.rawPayload.equals(png)).toBe(true);
	});

	it('exposes the last frame observations in /api/state', async () => {
		const airObs = { ...obs('air', 'TX-SEN'), templateId: 'ticker_v1' };
		app = makeWebServer({
			composition: makeComposition(),
			getLastFrame: () => ({ hash: 'h', observations: [airObs], png: Buffer.from('x'), ts: 9 }),
		});
		const res = await app.inject({ method: 'GET', url: '/api/state' });
		const body = res.json() as { lastFrame: { observations: { raceKey: string }[]; ts: number } };
		expect(body.lastFrame.ts).toBe(9);
		expect(body.lastFrame.observations[0]!.raceKey).toBe('TX-SEN');
	});

	it('sends / to the web view on its dev server', async () => {
		app = makeWebServer({ composition: makeComposition() });
		const res = await app.inject({ headers: { host: 'localhost:8787' }, method: 'GET', url: '/' });
		expect(res.headers.location).toBe('http://localhost:5173/');
	});

	it('serves alert history newest-first with a bounded limit', async () => {
		const composition = makeComposition();
		composition.ingest([ross(1_000, 100)]);
		composition.ingest([air(10_000, 150)]);
		composition.ingest([air(20_000, 100)]);
		app = makeWebServer({ composition });
		type Events = { events: { kind: string; ts: number; type: string }[] };
		const all = (await app.inject({ method: 'GET', url: '/api/alert-history' })).json() as Events;
		expect(all.events.map((event) => [event.kind, event.type, event.ts])).toEqual([
			['cleared', 'votes_mismatch', 20_000],
			['raised', 'votes_mismatch', 10_000],
		]);
		const one = (
			await app.inject({ method: 'GET', url: '/api/alert-history?limit=1' })
		).json() as Events;
		expect(one.events.map((event) => event.ts)).toEqual([20_000]);
	});

	it('lists each aired race once, as its latest read, beside what its sources said then', async () => {
		const composition = makeComposition();
		composition.ingest([
			{
				...obs('DDHQ', TX_SENATE, {
					calledFor: ['p1'],
					candidates: [
						{ key: 'p3', name: 'Third Party', pct: 5, votes: 10 },
						{ key: 'p2', name: 'Colin Allred', pct: 35, votes: 50 },
						{ key: 'p1', name: 'Ken Paxton', pct: 60, votes: 100 },
					],
					pctIn: 80,
				}),
				observedAt: 500,
				providerRaceId: '77',
			},
		]);
		composition.ingest([ross(1_000, 100), { ...obs('Ross', 'GA-HOUSE'), observedAt: 1_000 }]);
		composition.ingest([air(10_000, 150)]);
		// Ross catches up after the read; the read is a record of what it was held against.
		composition.ingest([ross(11_000, 150)]);
		app = makeWebServer({ composition });

		const body = (await app.inject({ method: 'GET', url: '/api/races' })).json() as {
			races: Record<string, unknown>[];
		};
		// GA-HOUSE never aired, so it isn't listed.
		expect(body.races).toEqual([
			{
				airedAt: 10_000,
				anomalies: [
					{
						detail: 'Air shows 150 for KEN PAXTON; Ross had 100',
						severity: 'high',
						type: 'votes_mismatch',
					},
				],
				// The graphic's candidates; the others on DDHQ's ballot aren't on it.
				candidates: [
					{
						cells: {
							air: { called: true, pct: 60, votes: 150 },
							DDHQ: { called: true, pct: 60, votes: 100 },
							Ross: { called: true, pct: 60, votes: 100 },
						},
						name: 'KEN PAXTON',
						party: 'D',
					},
				],
				heading: 'TX U.S. SENATE',
				linked: true,
				pctIn: { air: 80, DDHQ: 80, Ross: 80 },
				pctInIsMinimum: false,
				raceKey: TX_SENATE,
				saidAt: { air: 10_000, DDHQ: 500, Ross: 1_000 },
				templateId: 'ticker_v1',
			},
		]);
	});

	it('marks a read whose heading fits no DDHQ race, with nothing beside it', async () => {
		const composition = makeComposition();
		composition.ingest([air(10_000, 150)]);
		app = makeWebServer({ composition });
		const body = (await app.inject({ method: 'GET', url: '/api/races' })).json() as {
			races: Record<string, unknown>[];
		};
		expect(body.races).toMatchObject([
			{
				anomalies: [],
				heading: 'TX U.S. SENATE',
				linked: false,
				pctIn: { air: 80, DDHQ: null, Ross: null },
				raceKey: 'TX U.S. SENATE',
			},
		]);
	});

	it('serves every read of a race and every observation of it, newest first', async () => {
		const composition = makeComposition();
		composition.ingest([ross(1_000, 100)]);
		composition.ingest([air(10_000, 150)]);
		composition.ingest([ross(11_000, 150)]);
		composition.ingest([air(20_000, 150)]);
		app = makeWebServer({ composition });
		const race = (
			await app.inject({ method: 'GET', url: `/api/race/${encodeURIComponent(TX_SENATE)}` })
		).json() as {
			observations: RaceObservation[];
			reads: { airedAt: number; anomalies: unknown[]; saidAt: { Ross: number } }[];
		};
		expect(
			race.reads.map((read) => [read.airedAt, read.saidAt.Ross, read.anomalies.length]),
		).toEqual([
			[20_000, 11_000, 0],
			[10_000, 1_000, 1],
		]);
		expect(race.observations.map((entry) => [entry.source, entry.observedAt])).toEqual([
			['air', 20_000],
			['Ross', 11_000],
			['air', 10_000],
			['Ross', 1_000],
		]);
	});

	it('gets and sets cadence', async () => {
		let cadence: { intervalMs: number; mode: 'interval' | 'manual' } = {
			intervalMs: 5000,
			mode: 'interval',
		};
		app = makeWebServer({
			composition: makeComposition(),
			getCadence: () => cadence,
			setCadence: (next) => {
				cadence = { ...cadence, ...next };
			},
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
		app = makeWebServer({ composition: makeComposition(), matchStore });

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

	it('switches the DDHQ host and reports it in /api/state', async () => {
		let host: DdhqHost = 'production';
		const server = makeWebServer({
			composition: makeComposition(),
			ddhqHost: {
				get: () => host,
				set: (next) => {
					host = next;
				},
			},
		});
		app = server;
		const post = (payload: unknown) =>
			server.inject({ method: 'POST', payload: payload as object, url: '/api/ddhq-host' });
		expect((await post({ host: 'sim' })).statusCode).toBe(400);
		expect((await post({ host: 'integration' })).json()).toEqual({ host: 'integration' });
		expect((await app.inject({ method: 'GET', url: '/api/state' })).json().ddhqHost).toBe(
			'integration',
		);
	});

	it('switches between Live and Sim only while monitoring is stopped', async () => {
		let mode: Mode = 'live';
		let running = false;
		const status = () => ({ id: running ? 's' : null, running, startedAt: running ? 1 : null });
		const server = makeWebServer({
			composition: makeComposition(),
			mode: {
				get: () => mode,
				set: (next) => {
					mode = next;
				},
			},
			session: { start: status, status, stop: status },
		});
		app = server;
		const post = (payload: unknown) =>
			server.inject({ method: 'POST', payload: payload as object, url: '/api/mode' });
		expect((await post({ mode: 'integration' })).statusCode).toBe(400);
		expect((await post({ mode: 'sim' })).json()).toEqual({ mode: 'sim' });
		expect((await app.inject({ method: 'GET', url: '/api/state' })).json().mode).toBe('sim');
		running = true;
		const refused = await post({ mode: 'live' });
		expect(refused.statusCode).toBe(409);
		expect(mode).toBe('sim');
	});

	it('refuses mode and host switches when neither is wired', async () => {
		app = makeWebServer({ composition: makeComposition() });
		const mode = await app.inject({ method: 'POST', payload: { mode: 'sim' }, url: '/api/mode' });
		const host = await app.inject({
			method: 'POST',
			payload: { host: 'integration' },
			url: '/api/ddhq-host',
		});
		expect([mode.statusCode, host.statusCode]).toEqual([409, 409]);
		expect((await app.inject({ method: 'GET', url: '/api/state' })).json()).toMatchObject({
			ddhqHost: null,
			mode: null,
		});
	});

	it("reports each source's current failure in /api/state", async () => {
		app = makeWebServer({
			composition: makeComposition(),
			getSourceError: (source) =>
				source === 'air' ? { count: 2, message: 'no open tab', since: 1_000 } : undefined,
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
			composition: makeComposition(),
			matchStore: makeMatchStore(),
		});
		const res = await app.inject({
			method: 'POST',
			payload: { match: '  ' },
			url: '/api/air-match',
		});
		expect(res.statusCode).toBe(400);
	});

	it('lists sessions and maps prune and delete refusals to 409', async () => {
		app = makeWebServer({
			composition: makeComposition(),
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
