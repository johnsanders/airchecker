import type { Night, RacePlan, RaceResult, ResultResolver } from './night.js';

import { CHAMELEON_LAG_MS, DDHQ_LAG_MS, raceAt } from './night.js';

// The night as DDHQ and Chameleon would serve it, in the shapes the checker parses
// (its ddhqSchema.ts and chameleonSchema.ts), so its Sim mode sees one consistent night
// on all three sources. Both carry the same race and candidate ids, names, votes, % in and
// calls; Chameleon trails DDHQ by CHAMELEON_LAG_MS. Race key inputs (the race name, the
// office, no party, the district) are the same in both, since the checker joins on them.

const RACE_DATE = '2026-11-03';

// DDHQ's party ids aren't read by the checker beyond the schema; D and R get their real ones.
const DDHQ_PARTY_IDS: Record<string, number> = { D: 1, R: 2 };

// Only the ids the checker queries by are honored; it polls race_ids= lists in Sim.
const matchesQuery = (plan: RacePlan, params: URLSearchParams): boolean => {
	const raceIds = params.get('race_ids');
	const state = params.get('state');
	return (
		(raceIds === null || raceIds.split(',').includes(String(plan.race.ddhq.raceId))) &&
		(state === null || state === plan.race.state)
	);
};

const ddhqRace = (plan: RacePlan, result: RaceResult, updatedAt: string) => ({
	candidates: plan.race.candidates.map((candidate) => ({
		cand_id: candidate.candId,
		first_name: candidate.first,
		incumbent: candidate.incumbent,
		last_name: candidate.last,
		middle_name: null,
		party_id: DDHQ_PARTY_IDS[candidate.party] ?? 0,
		party_name: candidate.partyName,
		preferred_name: null,
		suffix: null,
	})),
	district: plan.race.district === '' ? null : plan.race.district,
	last_updated: updatedAt,
	level: plan.race.ddhq.level,
	name: plan.race.ddhq.name,
	office: plan.race.ddhq.office,
	party: null,
	party_id: null,
	race_date: RACE_DATE,
	race_id: plan.race.ddhq.raceId,
	reporting_type: 'estimated',
	state: plan.race.state,
	state_name: plan.race.stateName,
	topline_results: {
		call_times: [],
		called_candidates: result.candidates
			.filter((candidate) => candidate.isWinner)
			.map((candidate) => candidate.candidate.candId),
		estimated_votes: {
			estimated_votes_high: plan.expectedVotes,
			estimated_votes_low: plan.expectedVotes,
			estimated_votes_mid: plan.expectedVotes,
			turnout_high: result.pctIn,
			turnout_low: result.pctIn,
			turnout_mid: result.pctIn,
		},
		precincts: { percent: null, reporting: 0, total: 0 },
		total_votes: result.totalVotes,
		votes: Object.fromEntries(
			result.candidates.map((candidate) => [String(candidate.candidate.candId), candidate.votes]),
		),
	},
	year: plan.race.ddhq.year,
});

export const ddhqResponse = (
	night: Night,
	elapsedMs: number,
	nowMs: number,
	query: string,
	resolveResult: ResultResolver = raceAt,
) => {
	const params = new URLSearchParams(query);
	const updatedAt = new Date(nowMs).toISOString();
	const data = night.plans
		.filter((plan) => matchesQuery(plan, params))
		.map((plan) => ddhqRace(plan, resolveResult(plan, elapsedMs - DDHQ_LAG_MS), updatedAt));
	return {
		data,
		limit: data.length,
		next_page_url: null,
		page: 1,
		total: data.length,
		total_pages: 1,
	};
};

const chameleonContest = (plan: RacePlan, result: RaceResult, modifiedDate: string) => ({
	area: {
		District: plan.race.district,
		id: plan.race.ddhq.raceId,
		name: plan.race.stateName,
		nameShort:
			plan.race.district === '' ? plan.race.state : `${plan.race.state} - ${plan.race.district}`,
		state: plan.race.state,
	},
	choice: result.candidates.map((candidate, index) => ({
		elected: candidate.isWinner,
		firstName: candidate.candidate.first,
		id: candidate.candidate.candId,
		incumbent: candidate.candidate.incumbent,
		lastName: candidate.candidate.last,
		name: `${candidate.candidate.last}, ${candidate.candidate.first}`,
		name2: `${candidate.candidate.first} ${candidate.candidate.last}`,
		party: { name: candidate.candidate.partyName, nameShort: candidate.candidate.party },
		position: index + 1,
		votes: { total: candidate.votes, votePercent: Math.round(candidate.votePercent * 100) / 100 },
	})),
	contestType: plan.race.ddhq.name,
	dbVotesPercent: String(result.pctIn),
	event: {
		date: `${RACE_DATE}T00:00:00`,
		id: 383,
		name: `${RACE_DATE} General`,
		type: 'General Election',
	},
	id: plan.race.ddhq.raceId,
	modifiedDate,
	office: { id: 0, name: plan.race.office },
	officename: plan.race.ddhq.office,
	party: '',
	polls: {
		closingTime: '',
		isClosed: result.pctIn > 0,
		reported: 0,
		reportedPercent: String(result.pctIn),
		total: 0,
	},
	raceID: String(plan.race.ddhq.raceId),
});

export const chameleonPlaylist = (
	night: Night,
	elapsedMs: number,
	nowMs: number,
	resolveResult: ResultResolver = raceAt,
) => {
	const modifiedDate = new Date(nowMs - CHAMELEON_LAG_MS).toISOString();
	return {
		ElectionPlaylist: {
			contest: night.plans.map((plan) =>
				chameleonContest(plan, resolveResult(plan, elapsedMs - CHAMELEON_LAG_MS), modifiedDate),
			),
			id: 133,
			name: 'DDHQ MAIN',
		},
		generated: new Date(nowMs).toISOString(),
	};
};

// What the checker should poll in Sim: every race of the night, a few ids per query.
export const nightQueries = (night: Night): string[] => {
	const ids = night.plans.map((plan) => plan.race.ddhq.raceId);
	return Array.from(
		{ length: Math.ceil(ids.length / 50) },
		(_, index) => `race_ids=${ids.slice(index * 50, index * 50 + 50).join(',')}`,
	);
};
