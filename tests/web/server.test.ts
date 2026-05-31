import { afterEach, describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';
import makeStore from '../../src/store/store.js';
import { makeQueryStore } from '../../src/sources/provider/queryStore.js';
import { makeWebServer } from '../../src/web/server.js';
import type { FastifyInstance } from 'fastify';

const obs = (source: RaceObservation['source'], raceKey: string): RaceObservation => ({
  calledFor: [],
  candidates: [],
  observedAt: 1_700_000_000_000,
  pctIn: 0,
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
    const body = res.json() as { sources: { source: string; races: number; observations: number }[] };
    const ddhq = body.sources.find((s) => s.source === 'DDHQ')!;
    const air = body.sources.find((s) => s.source === 'air')!;
    const ross = body.sources.find((s) => s.source === 'Ross')!;
    expect(ddhq.observations).toBe(1);
    expect(air.observations).toBe(1);
    expect(ross.observations).toBe(0);
  });

  it('returns recent alerts newest-first', async () => {
    const alerts: Anomaly[] = [
      { detail: 'a', involves: {}, observedAt: 1, owner: 'us', raceKey: 'R', severity: 'low', type: 'vote_drop' },
      { detail: 'b', involves: {}, observedAt: 2, owner: 'us', raceKey: 'R', severity: 'high', type: 'premature_call' },
    ];
    app = makeWebServer({ getRecentAlerts: () => alerts, store: makeStore() });
    const res = await app.inject({ method: 'GET', url: '/api/state' });
    const body = res.json() as { alerts: { detail: string }[] };
    expect(body.alerts.map((a) => a.detail)).toEqual(['b', 'a']);
  });

  it('gets and sets DDHQ queries', async () => {
    const queryStore = makeQueryStore();
    app = makeWebServer({ getRecentAlerts: () => [], queryStore, store: makeStore() });

    expect((await app.inject({ method: 'GET', url: '/api/queries' })).json()).toEqual({ queries: [] });

    const post = await app.inject({
      method: 'POST',
      url: '/api/queries',
      payload: { queries: ['race_ids=1', '  ', 'state=TX'] },
    });
    expect(post.json()).toEqual({ queries: ['race_ids=1', 'state=TX'] });
    expect(queryStore.get()).toEqual(['race_ids=1', 'state=TX']);
  });

  it('rejects malformed query payloads', async () => {
    app = makeWebServer({ getRecentAlerts: () => [], queryStore: makeQueryStore(), store: makeStore() });
    const res = await app.inject({ method: 'POST', url: '/api/queries', payload: { queries: 'nope' } });
    expect(res.statusCode).toBe(400);
  });

  it('triggers a manual capture and reports the result', async () => {
    let captures = 0;
    app = makeWebServer({
      getRecentAlerts: () => [],
      store: makeStore(),
      triggerCapture: async () => {
        captures += 1;
        return true;
      },
    });
    const res = await app.inject({ method: 'POST', url: '/api/capture' });
    expect(res.json()).toEqual({ ran: true });
    expect(captures).toBe(1);
  });

  it('serves the last frame PNG', async () => {
    const png = Buffer.from('\x89PNG fake');
    app = makeWebServer({
      getLastFrame: () => ({ hash: 'h', png, ts: 5 }),
      getRecentAlerts: () => [],
      store: makeStore(),
    });
    const res = await app.inject({ method: 'GET', url: '/api/last-frame' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect(res.rawPayload.equals(png)).toBe(true);
  });

  it('serves the HTML page at /', async () => {
    app = makeWebServer({ getRecentAlerts: () => [], store: makeStore() });
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Eagle Eye');
  });
});
