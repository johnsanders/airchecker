import { z } from 'zod';

import type { Settings } from '../settings.js';
import type { DdhqAuth } from '../sources/ddhqAuth.js';
import type { HttpJson } from '../sources/http.js';

import { DDHQ_INTEGRATION_URL } from '../settings.js';
import { errorMessage } from '../sources/http.js';

// While recording, fetches what airchecker's pollers fetch, every settings interval:
// every DDHQ query (all pages, from DDHQ's integration host) and the Chameleon playlist. The HTTP it's given records each GET;
// this loop only makes the calls. Failures are kept for the web view and never stop
// the loop, since a recording of the night's errors is still a recording of the night.

// The fixed, known network Chameleon blade (VPN-only).
export const CHAMELEON_URL =
	'http://txdaldc1nnr001.nexstar.tv/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json&pretty=yes&dynFieldDefaultAttr=false';

export type RecordLoop = {
	errors: () => string[]; // the last tick's failures
	start: () => void;
	stop: () => void;
	tickOnce: () => Promise<void>;
};

export type RecordLoopConfig = {
	auth: DdhqAuth;
	chameleonUrl?: string;
	ddhqHttp: HttpJson;
	getSettings: () => Settings;
	vendorHttp: HttpJson;
};

const pageSchema = z.object({ next_page_url: z.string().nullable().optional() });

// DDHQ's next_page_url has no scheme ('race-api.decisiondeskhq.com/api/v4/...')
// and names a different host than the documented API; fetch can't parse it as
// is. Re-base its path + query onto the polled baseUrl, which is also the
// host the bearer token was issued for.
export const rebaseNextPageUrl = (nextPageUrl: string, baseUrl: string): string => {
	const pathStart = nextPageUrl.indexOf('/api/');
	return pathStart === -1 ? nextPageUrl : `${baseUrl}${nextPageUrl.slice(pathStart)}`;
};

export const makeRecordLoop = (config: RecordLoopConfig): RecordLoop => {
	const chameleonUrl = config.chameleonUrl ?? CHAMELEON_URL;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastErrors: string[] = [];

	const fetchPage = async (url: string): Promise<unknown> => {
		const attempt = async (): Promise<unknown> =>
			config.ddhqHttp.getJson(url, { Authorization: `Bearer ${await config.auth.getToken()}` });
		try {
			return await attempt();
		} catch (error) {
			if (!(error instanceof Error && /HTTP 401/.test(error.message))) throw error;
			config.auth.invalidate();
			return attempt();
		}
	};

	const recordQuery = async (baseUrl: string, query: string): Promise<void> => {
		let url: null | string = `${baseUrl}/api/v4/races?${query}`;
		while (url !== null) {
			const next: null | string | undefined = pageSchema.parse(await fetchPage(url)).next_page_url;
			url =
				next === null || next === undefined || next.length === 0
					? null
					: rebaseNextPageUrl(next, baseUrl);
		}
	};

	const tickOnce = async (): Promise<void> => {
		const results = await Promise.allSettled([
			...config.getSettings().queries.map(async (query) => {
				try {
					await recordQuery(DDHQ_INTEGRATION_URL, query);
				} catch (error) {
					throw new Error(`DDHQ ${query}: ${errorMessage(error)}`);
				}
			}),
			config.vendorHttp.getJson(chameleonUrl).catch((error: unknown) => {
				throw new Error(`Chameleon: ${errorMessage(error)}`);
			}),
		]);
		lastErrors = results
			.filter((result) => result.status === 'rejected')
			.map((result) => errorMessage(result.reason));
		lastErrors.forEach((message) => console.error(`[record] ${message}`));
	};

	// Re-armed each tick, not setInterval, so an interval saved mid-recording takes
	// effect after the wait already underway.
	const schedule = (): void => {
		timer = setTimeout(() => {
			void tickOnce();
			schedule();
		}, config.getSettings().intervalSeconds * 1000);
	};

	return {
		errors: () => [...lastErrors],
		start: () => {
			if (timer !== undefined) return;
			lastErrors = [];
			void tickOnce();
			schedule();
		},
		stop: () => {
			clearTimeout(timer);
			timer = undefined;
		},
		tickOnce,
	};
};
