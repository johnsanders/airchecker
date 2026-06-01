import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { ProviderPoller } from './poller.js';
import type { QueryStore } from './queryStore.js';

import { makeFetchHttp } from '../http.js';
import { makeDdhqAuth } from './auth.js';
import { makeProviderPoller } from './poller.js';
import { makeQueryStore } from './queryStore.js';

// Assembles the live DDHQ provider source. Credentials are read from process.env
// HERE and handed straight to the auth module — never logged or returned. Query
// strings are NOT from env: they're runtime state in queryStore, edited via the
// web UI. The caller may inject a persistent queryStore (settings-backed) so edits
// survive restarts; the default is in-memory and starts empty.
//   DDHQ_BASE_URL      (default https://resultsapi.decisiondeskhq.com)
//   DDHQ_CLIENT_ID / DDHQ_CLIENT_SECRET / DDHQ_GRANT_TYPE  (required)
//   DDHQ_POLL_INTERVAL_MS  (default 60000 — once per minute)

const DEFAULT_BASE_URL = 'https://resultsapi.decisiondeskhq.com';
const DEFAULT_POLL_INTERVAL_MS = 60_000;

export type ProviderSource = {
	intervalMs: number;
	poller: ProviderPoller;
	queryStore: QueryStore; // exposed so the web server can get/set the query list
};

export const makeProviderSource = (
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown,
	queryStore: QueryStore = makeQueryStore(),
): ProviderSource => {
	const clientId = process.env.DDHQ_CLIENT_ID;
	const clientSecret = process.env.DDHQ_CLIENT_SECRET;
	const grantType = process.env.DDHQ_GRANT_TYPE;
	if (clientId === undefined || clientSecret === undefined || grantType === undefined)
		throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');

	const baseUrl = process.env.DDHQ_BASE_URL ?? DEFAULT_BASE_URL;
	const http = makeFetchHttp();
	const auth = makeDdhqAuth({ baseUrl, credentials: { clientId, clientSecret, grantType }, http });
	const intervalRaw = Number(process.env.DDHQ_POLL_INTERVAL_MS);
	const intervalMs =
		Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_POLL_INTERVAL_MS;

	const poller = makeProviderPoller({
		auth,
		baseUrl,
		getQueries: queryStore.get,
		http,
		onError: (query, error) => console.error(`[provider] query failed: ${query}`, error),
		onObservations,
	});

	return { intervalMs, poller, queryStore };
};
