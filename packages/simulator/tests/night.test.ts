import { describe, expect, it } from 'vitest';

import type { Race } from '../src/air/races.js';

import { formatPctIn, graphicData, makeNight, raceAt } from '../src/air/night.js';
import { loadRaces } from '../src/air/races.js';

const DURATION_MS = 30 * 60_000;
const races = loadRaces('races.json');
const night = makeNight(races, 42, DURATION_MS);
const candidate = (candId: number, first: string, last: string, partyName: string) => ({
	candId,
	first,
	incumbent: false,
	last,
	party: partyName.slice(0, 1),
	partyName,
});
const minutes = Array.from({ length: 41 }, (_, index) => index * 60_000);

const race = (overrides: Partial<Race>): Race => ({
	candidates: [],
	ddhq: { level: 'Federal', name: 'General Election', office: 'US Senate', raceId: 1, year: 2026 },
	district: '',
	graphics: ['fs', 'l3'],
	key: 'Test/U.S. Senate/',
	office: 'U.S. Senate',
	state: 'TS',
	stateName: 'Test',
	...overrides,
});

describe('makeNight', () => {
	it('is the same night for the same seed', () =>
		expect(makeNight(races, 42, DURATION_MS)).toEqual(night));

	it('puts the Democrat left and the Republican right', () =>
		night.plans
			.filter((plan) => plan.race.candidates.some((candidate) => candidate.party === 'D'))
			.forEach((plan) => {
				expect(plan.left.party).toBe('D');
				expect(plan.right.party).toBe('R');
			}));

	it('puts an independent left when there is no Democrat', () => {
		const plan = makeNight(
			[
				race({
					candidates: [
						candidate(1, 'Pete', 'Ricketts', 'Republican'),
						candidate(2, 'Jane', 'Marvin', 'Libertarian'),
						candidate(3, 'Dan', 'Osborn', 'Independent'),
					],
				}),
			],
			1,
			DURATION_MS,
		).plans[0];
		expect(plan?.left.last).toBe('Osborn');
		expect(plan?.right.last).toBe('Ricketts');
	});

	it('finishes reporting inside the night', () =>
		night.plans.forEach((plan) => {
			expect(plan.reportingStartMs).toBeLessThan(plan.reportingEndMs);
			expect(plan.reportingEndMs).toBeLessThanOrEqual(DURATION_MS);
		}));
});

describe('raceAt', () => {
	it('shows nothing before poll close', () =>
		night.plans
			.filter((plan) => plan.reportingStartMs > 0)
			.forEach((plan) => {
				const result = raceAt(plan, 0);
				expect(result.pctIn).toBe(0);
				expect(result.left.votes + result.right.votes).toBe(0);
				expect(result.left.isWinner || result.right.isWinner).toBe(false);
			}));

	it('only ever raises % in and votes, and never uncalls a race', () =>
		night.plans.forEach((plan) =>
			minutes.slice(1).forEach((minute, index) => {
				const before = raceAt(plan, minutes[index] ?? 0);
				const after = raceAt(plan, minute);
				expect(after.pctIn).toBeGreaterThanOrEqual(before.pctIn);
				after.candidates.forEach((result, candidateIndex) =>
					expect(result.votes).toBeGreaterThanOrEqual(
						before.candidates[candidateIndex]?.votes ?? 0,
					),
				);
				if (before.left.isWinner) expect(after.left.isWinner).toBe(true);
				if (before.right.isWinner) expect(after.right.isWinner).toBe(true);
			}),
		));

	it('makes every percent from the same whole-vote totals', () =>
		night.plans.forEach((plan) =>
			minutes.forEach((minute) => {
				const result = raceAt(plan, minute);
				expect(result.totalVotes).toBe(
					result.candidates.reduce((sum, candidate) => sum + candidate.votes, 0),
				);
				expect(Number.isInteger(result.pctIn)).toBe(true);
				result.candidates.forEach((candidate) =>
					expect(candidate.votePercent).toBeCloseTo(
						result.totalVotes === 0 ? 0 : (candidate.votes / result.totalVotes) * 100,
					),
				);
			}),
		));

	it('calls at most one winner, the one ahead at the end', () =>
		night.plans.forEach((plan) => {
			const final = raceAt(plan, DURATION_MS);
			expect(final.left.isWinner && final.right.isWinner).toBe(false);
			if (final.left.isWinner) expect(final.left.votes).toBeGreaterThan(final.right.votes);
			if (final.right.isWinner) expect(final.right.votes).toBeGreaterThan(final.left.votes);
		}));

	it('calls most races by the end of the night', () =>
		expect(
			night.plans.filter((plan) => {
				const final = raceAt(plan, DURATION_MS);
				return final.left.isWinner || final.right.isWinner;
			}).length,
		).toBeGreaterThan(races.length * 0.8));
});

describe('graphicData', () => {
	it('labels House races by district and splits names with |', () => {
		const plan = night.plans.find((candidate) => candidate.race.district !== '');
		if (plan === undefined) throw new Error('no House race in races.json');
		const data = graphicData(plan, raceAt(plan, DURATION_MS));
		expect(data.state).toBe(`${plan.race.state}-${plan.race.district}`);
		expect(data.race).toBe('U.S. House');
		expect(data.cand1.name).toBe(`${plan.left.first}|${plan.left.last}`);
	});

	it('prints % in the way air does', () => {
		expect(formatPctIn(0)).toBe('0');
		expect(formatPctIn(42)).toBe('42');
		expect(formatPctIn(97)).toBe('>95');
	});
});
