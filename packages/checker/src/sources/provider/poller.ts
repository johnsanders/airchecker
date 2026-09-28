import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { HttpJson } from '../http.js';
import type { DdhqAuth } from './auth.js';

import { adaptResponse } from './adapter.js';
import { ddhqResponseSchema } from './ddhqSchema.js';

// Polls DDHQ /api/v4/races for a CONFIGURABLE ARRAY of query strings (the full
// picture needs several calls; the array is UI-driven). Each tick, for each query:
// fetch with a bearer token, follow next_page_url, adapt every race to a
// RaceObservation, hand them to onObservations. Per-query errors are isolated so
// one bad query doesn't sink the tick; a 401 invalidates the token and retries once.

export type ProviderPoller = {
	pollOnce: () => Promise<void>;
};

export type ProviderPollerConfig = {
	auth: DdhqAuth;
	getBaseUrl: () => string; // read per query, so an environment switch lands on the next poll
	// Read FRESH each tick — queries are runtime state edited via the web UI, so a
	// getter (not a static array) lets edits take effect on the next poll with no
	// restart. Each string becomes /api/v4/races?<query>, e.g. 'race_ids=123,456'.
	getQueries: () => Promise<string[]> | string[];
	http: HttpJson;
	now?: () => number; // observedAt clock; default Date.now
	onError?: (query: string, error: unknown) => void;
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown;
};

// DDHQ's next_page_url has no scheme ('race-api.decisiondeskhq.com/api/v4/...')
// and names a different host than the documented API; fetch can't parse it as
// is. Re-base its path + query onto the polled baseUrl, which is also the
// host the bearer token was issued for.
export const rebaseNextPageUrl = (nextPageUrl: string, baseUrl: string): string => {
	const pathStart = nextPageUrl.indexOf('/api/');
	return pathStart === -1 ? nextPageUrl : `${baseUrl}${nextPageUrl.slice(pathStart)}`;
};

export const makeProviderPoller = (config: ProviderPollerConfig): ProviderPoller => {
	const now = config.now ?? Date.now;

	const fetchPage = async (url: string): Promise<unknown> => {
		const attempt = async (): Promise<unknown> => {
			const token = await config.auth.getToken();
			return config.http.getJson(url, { Authorization: `Bearer ${token}` });
		};
		try {
			return await attempt();
		} catch (error) {
			// One retry on auth failure: drop the cached token and re-fetch.
			if (error instanceof Error && /HTTP 401/.test(error.message)) {
				config.auth.invalidate();
				return attempt();
			}
			throw error;
		}
	};

	const runQuery = async (query: string): Promise<void> => {
		const observedAt = now();
		const baseUrl = config.getBaseUrl();
		let url: null | string = `${baseUrl}/api/v4/races?${query}`;
		while (url !== null && url.length > 0) {
			const raw: unknown = await fetchPage(url);
			const parsed = ddhqResponseSchema.parse(raw);
			await config.onObservations(adaptResponse(parsed, observedAt));
			// next_page_url is a URL, '' (no more), or null.
			url =
				parsed.next_page_url === null || parsed.next_page_url.length === 0
					? null
					: rebaseNextPageUrl(parsed.next_page_url, baseUrl);
		}
	};

	const pollOnce = async (): Promise<void> => {
		// Queries run independently — one failing query is reported and skipped, the
		// rest still land. (parallel: DDHQ tolerates it and a tick is once/minute.)
		const queries = await config.getQueries();
		await Promise.all(
			queries.map(async (query) => {
				try {
					await runQuery(query);
				} catch (error) {
					config.onError?.(query, error);
				}
			}),
		);
	};

	return { pollOnce };
};
