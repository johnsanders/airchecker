import { z } from 'zod';

import type { DdhqAuth } from '../sources/ddhqAuth.js';
import type { HttpJson } from '../sources/http.js';
import type { CandidateResult, RacePlan, RaceResult } from './night.js';
import type { Race, RaceCandidate } from './races.js';

import { DDHQ_INTEGRATION_URL } from '../settings.js';
import { errorMessage } from '../sources/http.js';

// A night's numbers pulled from DDHQ's integration host instead of invented (night.ts),
// for testing against DDHQ during its testing windows. Polls every race in races.json by
// race_ids (DDHQ's own id, 50 per request, DDHQ's page limit), every LIVE_RESULTS_INTERVAL_MS
// — DDHQ's integration results are themselves cached 60 s, so polling faster just repeats
// the same numbers. liveResultFor reads the cache for one race, in the plan's ballot order,
// keyed on races.json's candId (DDHQ's own cand_id) — the same identity nightMirror.ts uses,
// so a race with no live data yet (not in the cache) just reads as not started.

export const LIVE_RESULTS_INTERVAL_MS = 60_000;

const RACE_IDS_PER_QUERY = 50;

const toplineSchema = z.object({
	called_candidates: z.array(z.number()),
	estimated_votes: z.object({ turnout_mid: z.number() }).nullable().optional(),
	precincts: z.object({ percent: z.number().nullable() }),
	total_votes: z.number(),
	votes: z.record(z.string(), z.number()),
});

const ddhqRaceSchema = z.object({
	race_id: z.number(),
	// 'estimated' | 'precincts' — which progress figure the race reports in.
	reporting_type: z.string().optional(),
	topline_results: toplineSchema,
});

const responseSchema = z.object({ data: z.array(ddhqRaceSchema) });

export type LiveResultsConfig = {
	auth: DdhqAuth;
	http: HttpJson;
	intervalMs?: number;
	races: readonly Race[];
};

export type LiveResultsSource = {
	errors: () => string[]; // the last tick's failures
	getResult: (ddhqRaceId: number) => DdhqRace | undefined;
	start: () => void;
	stop: () => void;
	tickOnce: () => Promise<void>;
};

type DdhqRace = z.infer<typeof ddhqRaceSchema>;

const chunk = <T>(items: readonly T[], size: number): T[][] =>
	Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, index * size + size),
	);

export const makeLiveResults = (config: LiveResultsConfig): LiveResultsSource => {
	const intervalMs = config.intervalMs ?? LIVE_RESULTS_INTERVAL_MS;
	const raceIds = config.races.map((race) => race.ddhq.raceId);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cache = new Map<number, DdhqRace>();
	let lastErrors: string[] = [];

	const fetchChunk = async (ids: number[]): Promise<void> => {
		const url = `${DDHQ_INTEGRATION_URL}/api/v4/races?race_ids=${ids.join(',')}`;
		const attempt = async (): Promise<unknown> =>
			config.http.getJson(url, { Authorization: `Bearer ${await config.auth.getToken()}` });
		let raw: unknown;
		try {
			raw = await attempt();
		} catch (error) {
			if (!(error instanceof Error && /HTTP 401/.test(error.message))) throw error;
			config.auth.invalidate();
			raw = await attempt();
		}
		const response = responseSchema.parse(raw);
		response.data.forEach((race) => cache.set(race.race_id, race));
	};

	const tickOnce = async (): Promise<void> => {
		const results = await Promise.allSettled(chunk(raceIds, RACE_IDS_PER_QUERY).map(fetchChunk));
		lastErrors = results
			.filter((result) => result.status === 'rejected')
			.map((result) => errorMessage(result.reason));
		lastErrors.forEach((message) => console.error(`[live-results] ${message}`));
	};

	// Re-armed each tick, not setInterval, so overlapping ticks can't pile up on a slow response.
	const schedule = (): void => {
		timer = setTimeout(() => {
			void tickOnce();
			schedule();
		}, intervalMs);
	};

	return {
		errors: () => [...lastErrors],
		getResult: (ddhqRaceId) => cache.get(ddhqRaceId),
		start: () => {
			if (timer !== undefined) return;
			lastErrors = [];
			void tickOnce();
			schedule();
		},
		stop: () => {
			clearTimeout(timer);
			timer = undefined;
			cache = new Map();
		},
		tickOnce,
	};
};

// DDHQ reports progress two ways and says which per race: precinct reporting for
// municipal races, otherwise estimated_votes.turnout_mid (see the checker's adapter.ts,
// which this mirrors — everything on the Nov 3 package is 'estimated').
const pctInFor = (race: DdhqRace): number =>
	race.reporting_type === 'precincts'
		? (race.topline_results.precincts.percent ?? 0)
		: (race.topline_results.estimated_votes?.turnout_mid ?? 0);

export const liveResultFor = (plan: RacePlan, live: DdhqRace | undefined): RaceResult => {
	const totalVotes = live?.topline_results.total_votes ?? 0;
	const candidates: CandidateResult[] = plan.race.candidates.map((candidate) => {
		const votes = live?.topline_results.votes[String(candidate.candId)] ?? 0;
		return {
			candidate,
			isWinner: live?.topline_results.called_candidates.includes(candidate.candId) ?? false,
			votePercent: totalVotes === 0 ? 0 : (votes / totalVotes) * 100,
			votes,
		};
	});
	const resultFor = (candidate: RaceCandidate) =>
		candidates.find((result) => result.candidate === candidate) as CandidateResult;
	return {
		called: (live?.topline_results.called_candidates.length ?? 0) > 0,
		candidates,
		left: resultFor(plan.left),
		pctIn: live === undefined ? 0 : Math.floor(pctInFor(live)),
		right: resultFor(plan.right),
		totalVotes,
	};
};
