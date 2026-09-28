import { afterEach, describe, expect, it, vi } from 'vitest';

import type { HttpJson } from '../../src/sources/http.js';
import type { DdhqHost, Mode } from '../../src/sources/provider/providerSource.js';

import { makeProviderSource } from '../../src/sources/provider/providerSource.js';
import { makeQueryStore } from '../../src/sources/provider/queryStore.js';
import { makeVendorSource } from '../../src/sources/vendor/vendorSource.js';

const SIM = 'http://localhost:8788';
const EMPTY_PAGE = { data: [], next_page_url: null, page: 1, total: 0, total_pages: 0 };

// Answers a token POST and serves the simulator's query list; any other GET is an empty page.
const makeHttp = (): { gets: string[]; http: HttpJson; posts: string[] } => {
	const gets: string[] = [];
	const posts: string[] = [];
	return {
		gets,
		http: {
			getJson: async (url) => {
				gets.push(url);
				return url === `${SIM}/api/sim/queries` ? { queries: ['race_ids=1,2'] } : EMPTY_PAGE;
			},
			postJson: async (url) => {
				posts.push(url);
				return { access_token: 'token' };
			},
		},
		posts,
	};
};

describe('Live and Sim modes', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('polls the chosen DDHQ host with the saved queries in Live', async () => {
		vi.stubEnv('DDHQ_CLIENT_ID', 'id');
		vi.stubEnv('DDHQ_CLIENT_SECRET', 'secret');
		vi.stubEnv('DDHQ_GRANT_TYPE', 'client_credentials');
		let host: DdhqHost = 'integration';
		const { gets, http } = makeHttp();
		const provider = makeProviderSource(() => {}, makeQueryStore(['state=TX']), {
			getHost: () => host,
			getMode: () => 'live',
			http,
		});
		await provider.poller.pollOnce();
		host = 'production';
		await provider.poller.pollOnce();
		expect(gets).toEqual([
			'https://resultsapi-integration.decisiondeskhq.com/api/v4/races?state=TX',
			'https://resultsapi.decisiondeskhq.com/api/v4/races?state=TX',
		]);
	});

	it("polls the simulator in Sim, for the races it names, leaving Live's queries alone", async () => {
		const queryStore = makeQueryStore(['state=TX']);
		const { gets, http, posts } = makeHttp();
		const provider = makeProviderSource(() => {}, queryStore, {
			getHost: () => 'production',
			getMode: () => 'sim',
			http,
		});
		await provider.poller.pollOnce();
		expect(posts).toEqual([`${SIM}/api/v4/oauth/token`]);
		expect(gets).toEqual([`${SIM}/api/sim/queries`, `${SIM}/api/v4/races?race_ids=1,2`]);
		expect(queryStore.get()).toEqual(['state=TX']);
	});

	it('points Chameleon at the simulator in Sim and the real blade in Live', async () => {
		let mode: Mode = 'sim';
		const gets: string[] = [];
		const vendor = makeVendorSource(() => {}, {
			getMode: () => mode,
			http: {
				getJson: async (url) => {
					gets.push(url);
					return { ElectionPlaylist: { contest: [], id: 1, name: 'x' }, generated: '' };
				},
				postJson: async () => ({}),
			},
		});
		await vendor.poller.pollOnce();
		mode = 'live';
		await vendor.poller.pollOnce();
		expect(gets.map((url) => new URL(url).origin)).toEqual([
			SIM,
			'http://txdaldc1nnr001.nexstar.tv',
		]);
	});
});
