import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Anomaly, RaceObservation, SourceName } from '../reconcile/reconcile.js';
import { normalizeName } from '../reconcile/reconcile.js';
import type { CadenceConfig, CaptureResult } from '../sources/air/captureScheduler.js';
import type { QueryStore } from '../sources/provider/queryStore.js';
import type { Store } from '../store/store.js';

// The live web view at localhost:8787. The React SPA (src/web/client) is served as
// static files; everything else is a JSON API over injected handles — no source
// logic lives here.

export type LastFrameView = {
  hash: string;
  observations: RaceObservation[];
  png: Buffer;
  ts: number;
};

export type WebServerConfig = {
  getCadence?: () => CadenceConfig;
  getLastFrame?: () => LastFrameView | undefined;
  getRecentAlerts: () => Anomaly[];
  queryStore?: QueryStore; // DDHQ queries get/set; omitted if DDHQ isn't configured
  reconcileRace?: (raceKey: string, now: number) => Anomaly[];
  setCadence?: (next: Partial<CadenceConfig>) => void;
  store: Store;
  // Manual capture trigger (air scheduler's triggerCapture); omitted if air isn't wired.
  triggerCapture?: () => Promise<CaptureResult>;
};

const SOURCES: readonly SourceName[] = ['DDHQ', 'Ross', 'air'];

const historyFor = (store: Store, source: SourceName, raceKey: string): RaceObservation[] => {
  if (source === 'DDHQ') return store.getProviderHistory(raceKey);
  if (source === 'Ross') return store.getVendorHistory(raceKey);
  return store.getAirHistory(raceKey);
};

const latest = (history: RaceObservation[]): RaceObservation | undefined =>
  history.length === 0 ? undefined : history[history.length - 1];

// Strip the Buffer from an observation for JSON (frames live behind /api/last-frame).
const serializeObservation = (o: RaceObservation): Omit<RaceObservation, never> => o;

const clientDistDir = (): string => {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'client', 'dist');
};

export const makeWebServer = (config: WebServerConfig): FastifyInstance => {
  const app = Fastify();

  // --- API -----------------------------------------------------------------

  app.get('/api/state', () => {
    const store = config.store;
    const raceKeys = store.getRaceKeys();
    const sources = SOURCES.map((source) => {
      const histories = raceKeys.map((raceKey) => historyFor(store, source, raceKey));
      const observations = histories.reduce((sum, h) => sum + h.length, 0);
      const races = histories.filter((h) => h.length > 0).length;
      const lastAt = Math.max(0, ...histories.flat().map((o) => o.observedAt));
      return { lastAt: lastAt > 0 ? lastAt : null, observations, races, source };
    });
    const lastFrame = config.getLastFrame?.();
    return {
      alerts: config.getRecentAlerts().slice(-100).reverse(),
      cadence: config.getCadence?.() ?? null,
      lastFrame:
        lastFrame === undefined
          ? null
          : { observations: lastFrame.observations.map(serializeObservation), ts: lastFrame.ts },
      sources,
    };
  });

  // Race list: which sources have data, last activity, alert count.
  app.get('/api/races', () => {
    const store = config.store;
    const now = Date.now();
    return {
      races: store.getRaceKeys().map((raceKey) => {
        const present = Object.fromEntries(
          SOURCES.map((source) => [source, historyFor(store, source, raceKey).length > 0]),
        ) as Record<SourceName, boolean>;
        const lastAt = Math.max(
          0,
          ...SOURCES.flatMap((source) =>
            historyFor(store, source, raceKey).map((o) => o.observedAt),
          ),
        );
        const alertCount = config.reconcileRace?.(raceKey, now).length ?? 0;
        return { alertCount, lastAt: lastAt > 0 ? lastAt : null, present, raceKey };
      }),
    };
  });

  // Per-race comparison: latest observation per source, candidates aligned across
  // sources by normalized name, plus that race's current anomalies.
  app.get<{ Params: { raceKey: string } }>('/api/race/:raceKey', (req) => {
    const store = config.store;
    const raceKey = decodeURIComponent(req.params.raceKey);
    const perSource = SOURCES.map((source) => ({
      observation: latest(historyFor(store, source, raceKey)),
      source,
    }));

    // Union of candidates across sources, keyed by normalized name.
    const rows = new Map<
      string,
      { cells: Partial<Record<SourceName, { called: boolean; pct: number; votes: number }>>; name: string }
    >();
    perSource.forEach(({ observation, source }) => {
      observation?.candidates.forEach((candidate) => {
        const id = normalizeName(candidate.name);
        const row = rows.get(id) ?? { cells: {}, name: candidate.name };
        const called = (observation.calledFor ?? []).some(
          (key) => key === candidate.key || normalizeName(key) === id,
        );
        row.cells[source] = { called, pct: candidate.pct, votes: candidate.votes };
        rows.set(id, row);
      });
    });

    return {
      candidates: Array.from(rows.values()),
      anomalies: config.reconcileRace?.(raceKey, Date.now()) ?? [],
      raceKey,
      sources: perSource.map(({ observation, source }) => ({
        observedAt: observation?.observedAt ?? null,
        pctIn: observation?.pctIn ?? null,
        present: observation !== undefined,
        reportedAt: observation?.reportedAt ?? null,
        source,
      })),
    };
  });

  app.get('/api/last-frame', (_req, reply) => {
    const frame = config.getLastFrame?.();
    if (frame === undefined) return reply.code(404).send({ error: 'no frame' });
    return reply.type('image/png').send(frame.png);
  });

  app.post('/api/capture', async (_req, reply) => {
    if (config.triggerCapture === undefined)
      return reply.code(503).send({ ran: false, status: 'error', error: 'air capture not wired' });
    const result = await config.triggerCapture();
    // ran → success; skipped → busy; error → carry the real message so the UI is honest.
    if (result.status === 'error')
      return reply.code(500).send({ ran: false, status: 'error', error: result.message });
    return { ran: result.status === 'ran', status: result.status };
  });

  app.get('/api/cadence', (_req, reply) => {
    const cadence = config.getCadence?.();
    if (cadence === undefined) return reply.code(503).send({ error: 'cadence control not wired' });
    return cadence;
  });

  app.post<{ Body: { intervalMs?: unknown; mode?: unknown } }>('/api/cadence', (req, reply) => {
    if (config.setCadence === undefined || config.getCadence === undefined)
      return reply.code(503).send({ error: 'cadence control not wired' });
    const next: Partial<CadenceConfig> = {};
    if (req.body.mode === 'interval' || req.body.mode === 'manual') next.mode = req.body.mode;
    if (typeof req.body.intervalMs === 'number' && req.body.intervalMs > 0)
      next.intervalMs = req.body.intervalMs;
    config.setCadence(next);
    return config.getCadence();
  });

  app.get('/api/queries', () => ({ queries: config.queryStore?.get() ?? [] }));

  app.post<{ Body: { queries?: unknown } }>('/api/queries', (req, reply) => {
    if (config.queryStore === undefined)
      return reply.code(503).send({ error: 'DDHQ not configured' });
    const raw = req.body.queries;
    if (!Array.isArray(raw) || !raw.every((q) => typeof q === 'string'))
      return reply.code(400).send({ error: 'queries must be an array of strings' });
    config.queryStore.set(raw);
    return { queries: config.queryStore.get() };
  });

  // --- Static SPA ----------------------------------------------------------

  const distDir = clientDistDir();
  if (existsSync(join(distDir, 'index.html'))) {
    void app.register(fastifyStatic, { root: distDir });
    // SPA fallback for any non-API route.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', (_req, reply) =>
      reply
        .type('text/html')
        .send('<h1>Eagle Eye</h1><p>Web UI not built. Run <code>npm run web:build</code>, then restart.</p>'),
    );
  }

  return app;
};
