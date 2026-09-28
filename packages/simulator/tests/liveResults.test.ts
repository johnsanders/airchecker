import { describe, expect, it } from 'vitest';

import type { HttpJson } from '../src/sources/http.js';

import { liveResultFor, makeLiveResults } from '../src/air/liveResults.js';
import { makeNight } from '../src/air/night.js';
import { loadRaces } from '../src/air/races.js';
import { makeDdhqAuth } from '../src/sources/ddhqAuth.js';

const INTEGRATION = 'https://resultsapi-integration.decisiondeskhq.com';

const races = loadRaces('races.json');
const night = makeNight(races, 3, 30 * 60_000);
const plan = night.plans[0]!;

const routedHttp = (routes: Record<string, unknown>, headersSeen: string[] = []): HttpJson => ({
	getJson: async (url, headers) => {
		headersSeen.push(headers?.Authorization ?? '');
		const value = routes[url];
		if (value === undefined) throw new Error(`HTTP 404 for ${url}`);
		return value;
	},
	postJson: async () => ({ access_token: 'live-token', expires_in: 300 }),
});

const auth = (http: HttpJson) =>
	makeDdhqAuth({
		getBaseUrl: () => INTEGRATION,
		getCredentials: () => ({ clientId: 'id', clientSecret: 's', grantType: 'g' }),
		http,
	});

describe('makeLiveResults', () => {
	it('polls every race in chunks of 50, retries a 401, and caches by race id', async () => {
		const subset = races.slice(0, 60);
		const ids = subset.map((race) => race.ddhq.raceId);
		const [chunk1, chunk2] = [ids.slice(0, 50), ids.slice(50)];
		const raceUrl = (chunk: number[]) => `${INTEGRATION}/api/v4/races?race_ids=${chunk.join(',')}`;
		const topline = (raceId: number) => ({
			race_id: raceId,
			reporting_type: 'estimated',
			topline_results: {
				called_candidates: [],
				estimated_votes: { turnout_mid: 12 },
				precincts: { percent: null },
				total_votes: 500,
				votes: {},
			},
		});
		let unauthorized = true;
		const headersSeen: string[] = [];
		const http: HttpJson = {
			getJson: async (url, headers) => {
				headersSeen.push(headers?.Authorization ?? '');
				if (url === raceUrl(chunk1) && unauthorized) {
					unauthorized = false;
					throw new Error('HTTP 401 for x'); // the retry it forces re-fetches chunk1 below
				}
				if (url === raceUrl(chunk1)) return { data: chunk1.map(topline) };
				if (url === raceUrl(chunk2)) return { data: chunk2.map(topline) };
				throw new Error(`HTTP 404 for ${url}`);
			},
			postJson: async () => ({ access_token: 'live-token', expires_in: 300 }),
		};
		const live = makeLiveResults({ auth: auth(http), http, races: subset });

		await live.tickOnce();

		expect(live.errors()).toEqual([]);
		expect(headersSeen.filter((header) => header === 'Bearer live-token')).toHaveLength(3);
		expect(live.getResult(chunk1[0] as number)).toMatchObject({ race_id: chunk1[0] });
		expect(live.getResult(chunk2[0] as number)).toMatchObject({ race_id: chunk2[0] });
		expect(live.getResult(-1)).toBeUndefined();
	});

	it('reports a chunk failure without dropping the others', async () => {
		const subset = races.slice(0, 51); // two chunks: 50 + 1
		const ids = subset.map((race) => race.ddhq.raceId);
		const [chunk1, chunk2] = [ids.slice(0, 50), ids.slice(50)];
		const raceUrl = (chunk: number[]) => `${INTEGRATION}/api/v4/races?race_ids=${chunk.join(',')}`;
		const http = routedHttp({
			[raceUrl(chunk2)]: {
				data: [
					{
						race_id: chunk2[0],
						reporting_type: 'estimated',
						topline_results: {
							called_candidates: [],
							estimated_votes: { turnout_mid: 1 },
							precincts: { percent: null },
							total_votes: 0,
							votes: {},
						},
					},
				],
			},
			// chunk1's URL is deliberately missing, so its request 404s.
		});
		const live = makeLiveResults({ auth: auth(http), http, races: subset });

		await live.tickOnce();

		expect(live.errors()).toEqual([`HTTP 404 for ${raceUrl(chunk1)}`]);
		expect(live.getResult(chunk2[0] as number)).toBeDefined();
	});

	it('drops the cache on stop', async () => {
		const race = races[0] as (typeof races)[number];
		const http = routedHttp({
			[`${INTEGRATION}/api/v4/races?race_ids=${race.ddhq.raceId}`]: {
				data: [
					{
						race_id: race.ddhq.raceId,
						reporting_type: 'estimated',
						topline_results: {
							called_candidates: [],
							estimated_votes: { turnout_mid: 5 },
							precincts: { percent: null },
							total_votes: 0,
							votes: {},
						},
					},
				],
			},
		});
		const live = makeLiveResults({ auth: auth(http), http, races: [race] });

		await live.tickOnce();
		expect(live.getResult(race.ddhq.raceId)).toBeDefined();

		live.start(); // idempotent: a tick is already cached, and start() only re-arms the timer
		live.stop();
		expect(live.getResult(race.ddhq.raceId)).toBeUndefined();
	});
});

describe('liveResultFor', () => {
	it('reads votes, pct, called and totals from the live topline, in ballot order', () => {
		const totalVotes = plan.race.candidates.length * 100;
		const votes = Object.fromEntries(
			plan.race.candidates.map((candidate, index) => [String(candidate.candId), (index + 1) * 10]),
		);
		const live = {
			race_id: plan.race.ddhq.raceId,
			reporting_type: 'estimated',
			topline_results: {
				called_candidates: [plan.left.candId],
				estimated_votes: { turnout_mid: 42 },
				precincts: { percent: null },
				total_votes: totalVotes,
				votes,
			},
		};

		const result = liveResultFor(plan, live);

		expect(result.totalVotes).toBe(totalVotes);
		expect(result.pctIn).toBe(42);
		expect(result.called).toBe(true);
		expect(result.candidates.map((candidate) => candidate.candidate.candId)).toEqual(
			plan.race.candidates.map((candidate) => candidate.candId),
		);
		result.candidates.forEach((candidateResult, index) => {
			const expectedVotes = (index + 1) * 10;
			expect(candidateResult.votes).toBe(expectedVotes);
			expect(candidateResult.votePercent).toBeCloseTo((expectedVotes / totalVotes) * 100);
		});
		expect(result.left.candidate).toBe(plan.left);
		expect(result.left.isWinner).toBe(true);
		expect(result.right.isWinner).toBe(false);
	});

	it('reads as not yet reporting with no live data for the race', () => {
		const result = liveResultFor(plan, undefined);
		expect(result).toMatchObject({ called: false, pctIn: 0, totalVotes: 0 });
		result.candidates.forEach((candidateResult) => {
			expect(candidateResult.votes).toBe(0);
			expect(candidateResult.votePercent).toBe(0);
			expect(candidateResult.isWinner).toBe(false);
		});
	});

	it('reads % in from precincts when the race reports that way', () => {
		const live = {
			race_id: plan.race.ddhq.raceId,
			reporting_type: 'precincts',
			topline_results: {
				called_candidates: [],
				estimated_votes: null,
				precincts: { percent: 17.9 },
				total_votes: 0,
				votes: {},
			},
		};
		expect(liveResultFor(plan, live).pctIn).toBe(17);
	});
});
