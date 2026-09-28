import type { Race, RaceCandidate } from './races.js';
import type { Random } from './random.js';

import { between, makeRandom, pick, seedFrom } from './random.js';

// An invented election night. Each race gets hidden final numbers and a reporting window
// up front; raceAt() reads where it stands at any moment. Votes and % in only rise, each
// candidate's share leans one way early and settles on its final value, and a race is
// called once enough is in for its margin, and stays called.

export type CandidateResult = {
	candidate: RaceCandidate;
	isWinner: boolean;
	votePercent: number;
	votes: number;
};

// What the ticker, L3 and FS graphics take (window.renderGraphic in each).
export type GraphicData = {
	cand1: GraphicCandidate;
	cand2: GraphicCandidate;
	pctIn: string;
	race: string;
	state: string;
};

export type Night = { durationMs: number; plans: RacePlan[]; seed: number };

export type RacePlan = {
	// Early lean toward left (negative favors right). It fades as the vote comes in, and
	// is kept below both shares so neither candidate's votes can fall.
	bias: number;
	// Reporting progress (0–1) at which the race is called; 0 = at poll close, null = never.
	callAt: null | number;
	dropIntervalMs: number; // results land in drops, not continuously
	expectedVotes: number;
	finalPctIn: number;
	left: RaceCandidate;
	leftShare: number; // final share of all votes, 0–1
	race: Race;
	reportingEndMs: number;
	reportingStartMs: number; // poll close
	right: RaceCandidate;
	rightShare: number;
};

export type RaceResult = { left: CandidateResult; pctIn: number; right: CandidateResult };

type GraphicCandidate = {
	isWinner: boolean;
	name: string;
	party: string;
	votePercent: number;
	votes: number;
};

// With no Democrat, the left slot goes to the likeliest main opponent.
const LEFT_PARTY_PREFERENCE = ['D', 'I', 'L'];

// The graphics always show the Democrat left and the Republican right.
const chooseSides = (race: Race, random: Random): { left: RaceCandidate; right: RaceCandidate } => {
	const right = pick(
		random,
		race.candidates.filter((candidate) => candidate.party === 'R'),
	);
	const challengers = race.candidates.filter(
		(candidate) => candidate.party !== 'R' && candidate.party !== 'W',
	);
	const preferredParty = LEFT_PARTY_PREFERENCE.find((party) =>
		challengers.some((candidate) => candidate.party === party),
	);
	const left = pick(
		random,
		preferredParty === undefined
			? challengers
			: challengers.filter((candidate) => candidate.party === preferredParty),
	);
	if (left === undefined || right === undefined)
		throw new Error(`${race.key} needs a Republican and an opponent`);
	return { left, right };
};

const planRace = (race: Race, seed: number, durationMs: number): RacePlan => {
	const random = makeRandom(seedFrom(seed, race.key));
	const sides = chooseSides(race, random);
	// Summing three uniforms clusters the two-way split near 50/50, so plenty of races are close.
	const leftTwoWay = 0.5 + (random() + random() + random() - 1.5) * 0.25;
	const otherShare = race.candidates.length > 2 ? between(random, 0.01, 0.07) : 0;
	const leftShare = (1 - otherShare) * leftTwoWay;
	const rightShare = (1 - otherShare) * (1 - leftTwoWay);
	const margin = Math.abs(leftShare - rightShare);
	const reportingStartMs = random() * 0.4 * durationMs;
	const lastReportMs = 0.95 * durationMs;
	return {
		...sides,
		bias: between(random, -1, 1) * Math.min(0.08, 0.8 * Math.min(leftShare, rightShare)),
		callAt: margin < 0.01 ? null : Math.max(0, 0.95 - 3.5 * margin),
		dropIntervalMs: between(random, 15_000, 45_000),
		expectedVotes: Math.round(
			race.office === 'U.S. House'
				? between(random, 150_000, 400_000)
				: between(random, 400_000, 6_000_000),
		),
		finalPctIn: between(random, 97, 100),
		leftShare,
		race,
		reportingEndMs:
			reportingStartMs + between(random, 0.5, 0.95) * (lastReportMs - reportingStartMs),
		reportingStartMs,
		rightShare,
	};
};

export const makeNight = (races: readonly Race[], seed: number, durationMs: number): Night => ({
	durationMs,
	plans: races.map((race) => planRace(race, seed, durationMs)),
	seed,
});

// Reporting progress (0–1) at the last drop, front-loaded: early drops carry the most votes.
const progressAt = (plan: RacePlan, elapsedMs: number): number => {
	if (elapsedMs < plan.reportingStartMs) return 0;
	if (elapsedMs >= plan.reportingEndMs) return 1;
	const windowMs = plan.reportingEndMs - plan.reportingStartMs;
	const drops = Math.floor((elapsedMs - plan.reportingStartMs) / plan.dropIntervalMs);
	const linear = (drops * plan.dropIntervalMs) / windowMs;
	return 1 - (1 - linear) ** 2;
};

export const raceAt = (plan: RacePlan, elapsedMs: number): RaceResult => {
	const progress = progressAt(plan, elapsedMs);
	// Unrounded, so each candidate's rounded votes rise with progress.
	const totalVotes = plan.expectedVotes * (plan.finalPctIn / 100) * progress;
	const lean = plan.bias * (1 - progress);
	const called =
		elapsedMs >= plan.reportingStartMs && plan.callAt !== null && progress >= plan.callAt;
	const leftWins = plan.leftShare > plan.rightShare;
	const result = (candidate: RaceCandidate, share: number, wins: boolean): CandidateResult => {
		return {
			candidate,
			isWinner: called && wins,
			votePercent: totalVotes === 0 ? 0 : share * 100,
			votes: Math.round(totalVotes * share),
		};
	};
	return {
		left: result(plan.left, plan.leftShare + lean, leftWins),
		pctIn: plan.finalPctIn * progress,
		right: result(plan.right, plan.rightShare - lean, !leftWins),
	};
};

// As the graphics print it: "<1" for a trickle, ">95" once nearly complete.
export const formatPctIn = (pctIn: number): string => {
	if (pctIn === 0) return '0';
	if (pctIn < 1) return '<1';
	if (pctIn > 95) return '>95';
	return String(Math.round(pctIn));
};

// "|" splits first from last name in the graphics (multi-word surnames like "Van Orden").
const graphicCandidate = (result: CandidateResult): GraphicCandidate => ({
	isWinner: result.isWinner,
	name: `${result.candidate.first}|${result.candidate.last}`,
	party: result.candidate.party,
	votePercent: result.votePercent,
	votes: result.votes,
});

// House races read as "FL-22" on air.
export const graphicData = (plan: RacePlan, result: RaceResult): GraphicData => ({
	cand1: graphicCandidate(result.left),
	cand2: graphicCandidate(result.right),
	pctIn: formatPctIn(result.pctIn),
	race: plan.race.office,
	state: plan.race.district === '' ? plan.race.state : `${plan.race.state}-${plan.race.district}`,
});
