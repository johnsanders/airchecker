import { describe, expect, it } from 'vitest';

import type { CandidateState, RaceObservation } from '../../src/reconcile/reconcile.js';

import { observationChanged } from '../../src/runtime/observationChanged.js';

const cand = (key: string, name: string, votes: number, pct: number): CandidateState => ({
	key,
	name,
	party: 'R',
	pct,
	votes,
});

const obs = (overrides: Partial<RaceObservation> = {}): RaceObservation => ({
	calledFor: ['a'],
	candidates: [cand('a', 'Ken Paxton', 100, 60), cand('b', 'John Cornyn', 67, 40)],
	observedAt: 1_700_000_000_000,
	pctIn: 80,
	raceKey: '2026-TX-US_Senate-AL-Republican-Primary',
	reportedAt: null,
	source: 'DDHQ',
	...overrides,
});

describe('observationChanged', () => {
	it('treats a first-ever observation (no previous) as a change', () => {
		expect(observationChanged(undefined, obs())).toBe(true);
	});

	it('is false when the rendered data is identical', () => {
		expect(observationChanged(obs(), obs())).toBe(false);
	});

	it('ignores a fresh timestamp when the data is unchanged', () => {
		expect(observationChanged(obs({ observedAt: 1 }), obs({ observedAt: 2 }))).toBe(false);
	});

	it('detects a pctIn change', () => {
		expect(observationChanged(obs({ pctIn: 80 }), obs({ pctIn: 85 }))).toBe(true);
	});

	it('detects a vote change', () => {
		const previous = obs();
		const next = obs({
			candidates: [cand('a', 'Ken Paxton', 101, 60), cand('b', 'John Cornyn', 67, 40)],
		});
		expect(observationChanged(previous, next)).toBe(true);
	});

	it('detects a change in the called set', () => {
		expect(observationChanged(obs({ calledFor: ['a'] }), obs({ calledFor: ['a', 'b'] }))).toBe(
			true,
		);
	});

	it('detects a new candidate appearing', () => {
		const next = obs({
			candidates: [
				cand('a', 'Ken Paxton', 100, 50),
				cand('b', 'John Cornyn', 67, 30),
				cand('c', 'Other', 20, 20),
			],
		});
		expect(observationChanged(obs(), next)).toBe(true);
	});

	it('is order-insensitive for candidates and the called set', () => {
		const previous = obs({
			calledFor: ['a', 'b'],
			candidates: [cand('a', 'Ken Paxton', 100, 60), cand('b', 'John Cornyn', 67, 40)],
		});
		const reordered = obs({
			calledFor: ['b', 'a'],
			candidates: [cand('b', 'John Cornyn', 67, 40), cand('a', 'Ken Paxton', 100, 60)],
		});
		expect(observationChanged(previous, reordered)).toBe(false);
	});
});
