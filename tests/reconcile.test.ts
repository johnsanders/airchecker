import { describe, expect, it } from 'vitest';

import type { CandidateState, RaceObservation, SourceName } from '../src/reconcile/reconcile.js';

import reconcile, {
	checkCrossSurface,
	checkVoteDrop,
	normalizeName,
} from '../src/reconcile/reconcile.js';
import defaultThresholds from '../src/reconcile/thresholds.js';

const RACE = 'SENATE:PA';

type CandidateInit = { key: string; votes: number } & Partial<CandidateState>;

const candidate = (init: CandidateInit): CandidateState => ({
	key: init.key,
	name: init.name ?? init.key,
	party: init.party ?? 'D',
	pct: init.pct ?? 50,
	votes: init.votes,
});

type ObservationInit = {
	at: number;
	calledFor?: string | string[]; // string convenience → wrapped to a one-element set
	candidates: CandidateInit[];
	missingFields?: string[];
	pctIn?: number;
	pctInIsMinimum?: boolean;
	reportedAt?: null | number;
	source: SourceName;
	templateId?: string;
};

const toCalledFor = (value: string | string[] | undefined): string[] =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

const observation = (init: ObservationInit): RaceObservation => ({
	calledFor: toCalledFor(init.calledFor),
	candidates: init.candidates.map(candidate),
	observedAt: init.at,
	pctIn: init.pctIn ?? 50,
	...(init.pctInIsMinimum === true ? { pctInIsMinimum: true } : {}),
	...(init.missingFields === undefined ? {} : { missingFields: init.missingFields }),
	raceKey: RACE,
	reportedAt: init.reportedAt ?? null,
	source: init.source,
	...(init.templateId === undefined ? {} : { templateId: init.templateId }),
});

const baseInput = (overrides: {
	airHistory?: RaceObservation[];
	now?: number;
	providerHistory?: RaceObservation[];
	vendorHistory?: RaceObservation[];
}) => ({
	airHistory: overrides.airHistory ?? [],
	now: overrides.now ?? 1_000_000,
	providerHistory: overrides.providerHistory ?? [],
	raceKey: RACE,
	thresholds: defaultThresholds,
	vendorHistory: overrides.vendorHistory ?? [],
});

describe('normalizeName', () => {
	it.each([
		['John Smith', 'johnsmith'],
		['john smith', 'johnsmith'],
		['François', 'francois'],
		["O'Brien", 'obrien'],
		['  Padding  ', 'padding'],
		['José Ñoño', 'josenono'],
		['Smith-Jones', 'smithjones'],
	])('normalizes %j to %j', (input, expected) => {
		expect(normalizeName(input)).toBe(expected);
	});
});

describe('name mismatch', () => {
	it('emits no anomaly when air name matches provider roster', () => {
		const provider = observation({
			at: 900_000,
			candidates: [
				{ key: 'A', name: 'Jane Smith', votes: 100 },
				{ key: 'B', name: 'John Doe', votes: 95 },
			],
			source: 'DDHQ',
		});
		const air = observation({
			at: 999_000,
			candidates: [
				{ key: 'A', name: 'jane smith', votes: 100 },
				{ key: 'B', name: "O'BRIEN".replace("O'BRIEN", 'John Doe'), votes: 95 },
			],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.filter((a) => a.type === 'name_mismatch')).toHaveLength(0);
	});

	it('flags air candidate name that is not in provider roster', () => {
		const provider = observation({
			at: 900_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 999_000,
			candidates: [{ key: 'A', name: 'Bob Wrong', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		const mismatches = result.filter((a) => a.type === 'name_mismatch');
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]!.severity).toBe('high');
		expect(mismatches[0]!.owner).toBe('us');
	});
});

describe('vote total reconciliation', () => {
	it('passes when air vote total matches some vendor snapshot inside lag window', () => {
		const vendor1 = observation({
			at: 990_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 200 }],
			source: 'Ross',
		});
		const vendor2 = observation({
			at: 999_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 220 }],
			source: 'Ross',
		});
		const air = observation({
			at: 1_000_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 200 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendor1, vendor2] }));
		expect(result.filter((a) => a.type === 'votes_mismatch')).toHaveLength(0);
	});

	it('flags when air vote total appears nowhere in the lag window', () => {
		const vendor = observation({
			at: 990_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 200 }],
			source: 'Ross',
		});
		const air = observation({
			at: 1_000_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 99_999 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendor] }));
		const mismatches = result.filter((a) => a.type === 'votes_mismatch');
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]!.severity).toBe('high');
	});
});

describe('pct_in reconciliation', () => {
	it('passes when pct_in is within tolerance of a vendor snapshot', () => {
		const vendor = observation({
			at: 995_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			pctIn: 42,
			source: 'Ross',
		});
		const air = observation({
			at: 1_000_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			pctIn: 43,
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendor] }));
		expect(result.filter((a) => a.type === 'pct_in_mismatch')).toHaveLength(0);
	});

	it('flags when pct_in is far from any vendor snapshot in window', () => {
		const vendor = observation({
			at: 995_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			pctIn: 42,
			source: 'Ross',
		});
		const air = observation({
			at: 1_000_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			pctIn: 88,
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendor] }));
		expect(result.filter((a) => a.type === 'pct_in_mismatch')).toHaveLength(1);
	});
});

describe('call consistency', () => {
	it('flags premature_call when air calls a race the provider never called', () => {
		const provider = observation({
			at: 990_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: 'A',
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'premature_call')).toBeDefined();
	});

	it('flags call_mismatch when air calls a different candidate than provider', () => {
		const provider = observation({
			at: 990_000,
			calledFor: 'A',
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: 'B',
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'call_mismatch')).toBeDefined();
	});

	it('flags missing_call when provider has called but air has not after lag', () => {
		const callTime =
			1_000_000 -
			(defaultThresholds.providerToVendorLagMaxMs + defaultThresholds.vendorToAirLagMaxMs) -
			60_000;
		const provider = observation({
			at: callTime,
			calledFor: 'A',
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: [],
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'missing_call')).toBeDefined();
	});

	it('does not flag missing_call when call propagation could still be in flight', () => {
		const provider = observation({
			at: 1_000_000 - 10_000,
			calledFor: 'A',
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: [],
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'missing_call')).toBeUndefined();
	});

	it('flags missing_call in a top-two race when air shows only one of two called winners', () => {
		const callTime =
			1_000_000 -
			(defaultThresholds.providerToVendorLagMaxMs + defaultThresholds.vendorToAirLagMaxMs) -
			60_000;
		const provider = observation({
			at: callTime,
			calledFor: ['A', 'B'],
			candidates: [
				{ key: 'A', name: 'Cowan', votes: 100 },
				{ key: 'B', name: 'Adkerson', votes: 80 },
			],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: ['A'], // air only caught the leader's check mark
			candidates: [
				{ key: 'A', name: 'Cowan', votes: 100 },
				{ key: 'B', name: 'Adkerson', votes: 80 },
			],
			source: 'air',
			templateId: 'fullscreen_results',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'missing_call')).toBeDefined();
	});

	it('does not flag when air shows both winners of a top-two race', () => {
		const provider = observation({
			at: 990_000,
			calledFor: ['A', 'B'],
			candidates: [
				{ key: 'A', name: 'Cowan', votes: 100 },
				{ key: 'B', name: 'Adkerson', votes: 80 },
			],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: ['B', 'A'], // same set, order-independent
			candidates: [
				{ key: 'A', name: 'Cowan', votes: 100 },
				{ key: 'B', name: 'Adkerson', votes: 80 },
			],
			source: 'air',
			templateId: 'fullscreen_results',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(
			result.filter((a) => a.type === 'missing_call' || a.type === 'call_mismatch'),
		).toHaveLength(0);
	});

	it('does not flag call_mismatch when provider calls by upstream ID and air by the same name', () => {
		// The live false positive: DDHQ calledFor holds cand_ids ("808048"); air holds
		// names ("Nathan Johnson"). Same candidate — must resolve to a match, not mismatch.
		const provider = observation({
			at: 990_000,
			calledFor: '808048',
			candidates: [
				{ key: '808048', name: 'Nathan Johnson', votes: 332_330 },
				{ key: '808049', name: 'Joe Jaworski', votes: 219_021 },
			],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: 'Nathan Johnson',
			candidates: [
				{ key: 'Nathan Johnson', name: 'Nathan Johnson', votes: 228_973 },
				{ key: 'Joe Jaworski', name: 'Joe Jaworski', votes: 157_779 },
			],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		expect(result.find((a) => a.type === 'call_mismatch')).toBeUndefined();
	});

	it('still flags call_mismatch (named, not by ID) when the provider ID is a different candidate', () => {
		const provider = observation({
			at: 990_000,
			calledFor: '808049', // Joe Jaworski
			candidates: [
				{ key: '808048', name: 'Nathan Johnson', votes: 332_330 },
				{ key: '808049', name: 'Joe Jaworski', votes: 219_021 },
			],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			calledFor: 'Nathan Johnson',
			candidates: [
				{ key: 'Nathan Johnson', name: 'Nathan Johnson', votes: 228_973 },
				{ key: 'Joe Jaworski', name: 'Joe Jaworski', votes: 157_779 },
			],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(baseInput({ airHistory: [air], providerHistory: [provider] }));
		const mismatch = result.find((a) => a.type === 'call_mismatch');
		expect(mismatch).toBeDefined();
		// The alert names the candidate, never the raw upstream ID.
		expect(mismatch?.detail).toContain('Joe Jaworski');
		expect(mismatch?.detail).not.toContain('808049');
	});
});

describe('vote drop', () => {
	it('flags when drop exceeds both percent and absolute thresholds', () => {
		const earlier = observation({
			at: 900_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100_000 }],
			source: 'DDHQ',
		});
		const later = observation({
			at: 999_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 80_000 }],
			source: 'DDHQ',
		});
		const drops = checkVoteDrop(RACE, [earlier, later], 'DDHQ', defaultThresholds);
		expect(drops).toHaveLength(1);
		expect(drops[0]!.type).toBe('vote_drop');
	});

	it('does not flag a small drop below thresholds', () => {
		const earlier = observation({
			at: 900_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100_000 }],
			source: 'DDHQ',
		});
		const later = observation({
			at: 999_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 99_900 }],
			source: 'DDHQ',
		});
		const drops = checkVoteDrop(RACE, [earlier, later], 'DDHQ', defaultThresholds);
		expect(drops).toHaveLength(0);
	});

	it('does not flag a percent drop without absolute drop (recount of small race)', () => {
		const earlier = observation({
			at: 900_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 1_000 }],
			source: 'DDHQ',
		});
		const later = observation({
			at: 999_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 800 }],
			source: 'DDHQ',
		});
		const drops = checkVoteDrop(RACE, [earlier, later], 'DDHQ', defaultThresholds);
		expect(drops).toHaveLength(0);
	});
});

describe('cross-surface consistency', () => {
	it('flags when two air templates report different totals for the same candidate at the same time', () => {
		const now = 1_000_000;
		const ticker = observation({
			at: now,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const fullscreen = observation({
			at: now,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 150 }],
			source: 'air',
			templateId: 'fullscreen_senate_v1',
		});
		const anomalies = checkCrossSurface(RACE, [ticker, fullscreen], now);
		expect(anomalies).toHaveLength(1);
		expect(anomalies[0]!.type).toBe('cross_surface_mismatch');
		expect(anomalies[0]!.severity).toBe('high');
	});

	it('does not flag when two air templates agree', () => {
		const now = 1_000_000;
		const ticker = observation({
			at: now,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const fullscreen = observation({
			at: now,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'air',
			templateId: 'fullscreen_senate_v1',
		});
		const anomalies = checkCrossSurface(RACE, [ticker, fullscreen], now);
		expect(anomalies).toHaveLength(0);
	});
});

describe('air ahead of upstream', () => {
	it('flags when air vote totals exceed any provider snapshot at or near the same time', () => {
		const provider = observation({
			at: 1_000_001,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 100 }],
			source: 'DDHQ',
		});
		const air = observation({
			at: 1_000_000,
			candidates: [{ key: 'A', name: 'Jane Smith', votes: 500 }],
			source: 'air',
			templateId: 'ticker_v1',
		});
		const result = reconcile(
			baseInput({
				airHistory: [air],
				now: 1_000_002,
				providerHistory: [provider],
			}),
		);
		expect(result.find((a) => a.type === 'air_ahead_of_upstream')).toBeDefined();
	});
});

describe('pct_in floor (">95% IN")', () => {
	const air = observation({
		at: 1_000_000,
		candidates: [{ key: 'a', votes: 100 }],
		pctIn: 95,
		pctInIsMinimum: true,
		source: 'air',
	});
	const vendorAt = (pctIn: number): RaceObservation =>
		observation({
			at: 1_000_000 - defaultThresholds.vendorToAirLagMs,
			candidates: [{ key: 'a', votes: 100 }],
			pctIn,
			source: 'Ross',
		});

	it('accepts any vendor figure at or above the floor', () => {
		[95, 98, 100].forEach((pctIn) => {
			const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendorAt(pctIn)] }));
			expect(result.filter((a) => a.type === 'pct_in_mismatch')).toHaveLength(0);
		});
	});

	it('still flags a vendor figure below the floor', () => {
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendorAt(90)] }));
		const mismatches = result.filter((a) => a.type === 'pct_in_mismatch');
		expect(mismatches).toHaveLength(1);
		expect(mismatches[0]!.detail).toContain('>95');
	});
});

describe('multiple winners (single-winner cycle)', () => {
	const twoCalled = (source: SourceName): RaceObservation =>
		observation({
			at: 1_000_000,
			calledFor: ['a', 'b'],
			candidates: [
				{ key: 'a', name: 'Darline Graham', votes: 109_881 },
				{ key: 'b', name: 'Ralph Norman', votes: 82_628 },
			],
			source,
		});

	it('flags two ✓ on air as a display bug owned by us', () => {
		const result = reconcile(baseInput({ airHistory: [twoCalled('air')] }));
		const hits = result.filter((a) => a.type === 'multiple_winners');
		expect(hits).toHaveLength(1);
		expect(hits[0]!.owner).toBe('us');
		expect(hits[0]!.severity).toBe('high');
		expect(hits[0]!.detail).toContain('Darline Graham, Ralph Norman');
	});

	it("flags two called candidates upstream as that source's bug", () => {
		const provider = reconcile(baseInput({ providerHistory: [twoCalled('DDHQ')] }));
		expect(provider.filter((a) => a.type === 'multiple_winners')[0]!.owner).toBe('provider');
		const vendor = reconcile(baseInput({ vendorHistory: [twoCalled('Ross')] }));
		expect(vendor.filter((a) => a.type === 'multiple_winners')[0]!.owner).toBe('vendor');
	});

	it('is silent for one winner, and for two when the cycle allows two', () => {
		const one = observation({
			at: 1_000_000,
			calledFor: 'a',
			candidates: [
				{ key: 'a', votes: 10 },
				{ key: 'b', votes: 5 },
			],
			source: 'air',
		});
		expect(
			reconcile(baseInput({ airHistory: [one] })).filter((a) => a.type === 'multiple_winners'),
		).toHaveLength(0);
		const topTwo = {
			...baseInput({ airHistory: [twoCalled('air')] }),
			thresholds: { ...defaultThresholds, maxWinners: 2 },
		};
		expect(reconcile(topTwo).filter((a) => a.type === 'multiple_winners')).toHaveLength(0);
	});
});

describe('required field missing on air', () => {
	const air = observation({
		at: 1_000_000,
		candidates: [{ key: 'a', votes: 100 }],
		missingFields: ['pct_in'],
		pctIn: 0,
		source: 'air',
		templateId: 'fullscreen_results',
	});
	const vendor = observation({
		at: 1_000_000 - defaultThresholds.vendorToAirLagMs,
		candidates: [{ key: 'a', votes: 100 }],
		pctIn: 68,
		source: 'Ross',
	});

	it('emits field_missing and suppresses the pct_in comparison against the placeholder 0', () => {
		const result = reconcile(baseInput({ airHistory: [air], vendorHistory: [vendor] }));
		const missing = result.filter((a) => a.type === 'field_missing');
		expect(missing).toHaveLength(1);
		expect(missing[0]!.owner).toBe('us');
		expect(missing[0]!.detail).toContain('fullscreen_results');
		expect(missing[0]!.detail).toContain('pct_in');
		expect(result.filter((a) => a.type === 'pct_in_mismatch')).toHaveLength(0);
	});
});
