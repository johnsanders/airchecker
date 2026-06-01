import type { FastifyInstance } from 'fastify';

import { afterEach, describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';

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

	it('lists races with per-source presence and alert count', async () => {
		const store = makeStore();
		store.record(obs('DDHQ', 'TX-SEN'));
		store.record(obs('air', 'TX-SEN'));
		store.record(obs('Ross', 'GA-HOUSE'));
		app = makeWebServer({
			getRecentAlerts: () => [],
			reconcileRace: (raceKey) => (raceKey === 'TX-SEN' ? [{} as Anomaly] : []),
			store,
		});
		const body = (await app.inject({ method: 'GET', url: '/api/races' })).json() as {
			races: { alertCount: number; present: Record<string, boolean>; raceKey: string }[];
		};
		const tx = body.races.find((r) => r.raceKey === 'TX-SEN')!;
		expect(tx.present).toEqual({ air: true, DDHQ: true, Ross: false });
		expect(tx.alertCount).toBe(1);
		const ga = body.races.find((r) => r.raceKey === 'GA-HOUSE')!;
		expect(ga.present).toEqual({ air: false, DDHQ: false, Ross: true });
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
			payload: { match: 'actus' },
			url: '/api/air-match',
		});
		expect(res.json()).toEqual({ match: 'actus' });
		expect(matchStore.get()).toBe('actus');
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
});
