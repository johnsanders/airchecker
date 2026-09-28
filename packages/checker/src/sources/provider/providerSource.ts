import { z } from 'zod';

import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { HttpJson } from '../http.js';
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
//   DDHQ_BASE_URL      production host (default https://resultsapi.decisiondeskhq.com)
//   SIM_BASE_URL       the simulator, for Sim mode (default http://localhost:8788)
//   DDHQ_CLIENT_ID / DDHQ_CLIENT_SECRET / DDHQ_GRANT_TYPE  (required, except in Sim)
//   DDHQ_POLL_INTERVAL_MS  (default 60000 — once per minute)

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export type DdhqHost = 'integration' | 'production';

// Live watches the real sources; Sim watches the simulator, which stands in for all three
// (DDHQ and Chameleon on its mirrors, air on its /air/ page) and says which DDHQ queries
// cover the night it's serving. In Live, DDHQ is either production or its test host.
// Both are runtime state (switchable in the web view), read fresh each poll.
export type Mode = 'live' | 'sim';

export const simBaseUrl = (): string => process.env.SIM_BASE_URL ?? 'http://localhost:8788';

export const ddhqBaseUrl = (mode: Mode, host: DdhqHost): string => {
	if (mode === 'sim') return simBaseUrl();
	if (host === 'integration') return 'https://resultsapi-integration.decisiondeskhq.com';
	return process.env.DDHQ_BASE_URL ?? 'https://resultsapi.decisiondeskhq.com';
};

const simQueriesSchema = z.object({ queries: z.array(z.string()) });

export type ProviderSource = {
	intervalMs: number;
	poller: ProviderPoller;
	queryStore: QueryStore; // exposed so the web server can get/set the query list
};

export type ProviderSourceOptions = {
	getHost?: () => DdhqHost; // default production
	getMode?: () => Mode; // default live
	http?: HttpJson;
	// One query failing doesn't fail the poll (the others still run), so it's reported
	// here rather than thrown.
	onQueryError?: (query: string, error: unknown) => void;
};

// The simulator issues a token to anyone; real credentials never go to it.
const SIM_CREDENTIALS = {
	clientId: 'elex-sim',
	clientSecret: 'elex-sim',
	grantType: 'elex-sim',
};

const readCredentials = () => {
	const clientId = process.env.DDHQ_CLIENT_ID;
	const clientSecret = process.env.DDHQ_CLIENT_SECRET;
	const grantType = process.env.DDHQ_GRANT_TYPE;
	if (clientId === undefined || clientSecret === undefined || grantType === undefined)
		throw new Error('DDHQ_CLIENT_ID, DDHQ_CLIENT_SECRET, and DDHQ_GRANT_TYPE must be set');
	return { clientId, clientSecret, grantType };
};

export const makeProviderSource = (
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown,
	queryStore: QueryStore = makeQueryStore(),
	options: ProviderSourceOptions = {},
): ProviderSource => {
	const getMode = options.getMode ?? (() => 'live');
	const getHost = options.getHost ?? (() => 'production');
	const getCredentials = () => (getMode() === 'sim' ? SIM_CREDENTIALS : readCredentials());
	const getBaseUrl = (): string => ddhqBaseUrl(getMode(), getHost());
	const http = options.http ?? makeFetchHttp();
	// In Sim the saved query list is set aside: the simulator names the races it's serving.
	const getQueries = async (): Promise<string[]> =>
		getMode() === 'sim'
			? simQueriesSchema.parse(await http.getJson(`${simBaseUrl()}/api/sim/queries`)).queries
			: queryStore.get();
	const auth = makeDdhqAuth({ getBaseUrl, getCredentials, http });
	const intervalRaw = Number(process.env.DDHQ_POLL_INTERVAL_MS);
	const intervalMs =
		Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_POLL_INTERVAL_MS;

	const poller = makeProviderPoller({
		auth,
		getBaseUrl,
		getQueries,
		http,
		...(options.onQueryError === undefined ? {} : { onError: options.onQueryError }),
		onObservations,
	});

	return { intervalMs, poller, queryStore };
};
