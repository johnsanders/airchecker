import type { RaceObservation } from '../../reconcile/reconcile.js';
import { makeFetchHttp } from '../http.js';
import { makeDdhqAuth } from './auth.js';
import { makeProviderPoller } from './poller.js';
import type { ProviderPoller } from './poller.js';

// Assembles the live DDHQ provider source from env. Credentials are read from
// process.env HERE and handed straight to the auth module — they never get logged
// or returned. Config:
//   DDHQ_BASE_URL      (default https://resultsapi.decisiondeskhq.com)
//   DDHQ_CLIENT_ID / DDHQ_CLIENT_SECRET / DDHQ_GRANT_TYPE  (required)
//   DDHQ_QUERIES       JSON array of /api/v4/races query strings, e.g.
//                      ["race_ids=1,2,3","state=TX&office_id=3"]  (UI-driven later)
//   DDHQ_POLL_INTERVAL_MS  (default 60000 — once per minute)

const DEFAULT_BASE_URL = 'https://resultsapi.decisiondeskhq.com';
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export type ProviderSource = {
  intervalMs: number;
  poller: ProviderPoller;
  queries: string[];
};

const readQueries = (): string[] => {
  const raw = process.env.DDHQ_QUERIES;
  if (raw === undefined || raw.trim().length === 0) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string'))
    throw new Error('DDHQ_QUERIES must be a JSON array of strings');
  return parsed;
};

export const makeProviderSource = (
  onObservations: (observations: RaceObservation[]) => void,
): ProviderSource => {
  const clientId = process.env.DDHQ_CLIENT_ID;
  const clientSecret = process.env.DDHQ_CLIENT_SECRET;
  const grantType = process.env.DDHQ_GRANT_TYPE;
  if (clientId === undefined || clientSecret === undefined || grantType === undefined)
    throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');

  const baseUrl = process.env.DDHQ_BASE_URL ?? DEFAULT_BASE_URL;
  const http = makeFetchHttp();
  const auth = makeDdhqAuth({
    baseUrl,
    credentials: { clientId, clientSecret, grantType },
    http,
  });
  const intervalRaw = Number(process.env.DDHQ_POLL_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_POLL_INTERVAL_MS;
  const queries = readQueries();

  const poller = makeProviderPoller({
    auth,
    baseUrl,
    http,
    onError: (query, error) => console.error(`[provider] query failed: ${query}`, error),
    onObservations,
    queries,
  });

  return { intervalMs, poller, queries };
};
