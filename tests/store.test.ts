import { describe, expect, it, vi } from 'vitest';

import type { CandidateState, RaceObservation, SourceName } from '../src/reconcile/reconcile.js';

import makeStore from '../src/store/store.js';

const candidate = (): CandidateState => ({
	key: 'A',
	name: 'Jane Smith',
	party: 'D',
	pct: 50,
	votes: 100,
});

const observation = (source: SourceName, at: number, raceKey = 'TEST:RACE'): RaceObservation => ({
	calledFor: [],
	candidates: [candidate()],
	observedAt: at,
	pctIn: 50,
	raceKey,
	reportedAt: null,
	source,
});

describe('store', () => {
	it('records and reads back observations per source', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000));
		store.record(observation('Ross', 1_001));
		store.record(observation('air', 1_002));

		expect(store.getProviderHistory('TEST:RACE')).toHaveLength(1);
		expect(store.getVendorHistory('TEST:RACE')).toHaveLength(1);
		expect(store.getAirHistory('TEST:RACE')).toHaveLength(1);
	});

	it('separates observations by race key', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000, 'RACE:A'));
		store.record(observation('DDHQ', 1_001, 'RACE:B'));
		expect(store.getProviderHistory('RACE:A')).toHaveLength(1);
		expect(store.getProviderHistory('RACE:B')).toHaveLength(1);
		expect(store.getProviderHistory('RACE:C')).toHaveLength(0);
	});

	it('returns the union of race keys across sources without duplicates', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000, 'RACE:A'));
		store.record(observation('Ross', 1_001, 'RACE:A'));
		store.record(observation('air', 1_002, 'RACE:B'));
		expect(store.getRaceKeys().sort()).toEqual(['RACE:A', 'RACE:B']);
	});

	it('trims entries older than retentionMs', () => {
		const store = makeStore({ retentionMs: 1_000 });
		store.record(observation('DDHQ', 0));
		store.record(observation('DDHQ', 500));
		store.record(observation('DDHQ', 2_000));
		const history = store.getProviderHistory('TEST:RACE');
		expect(history).toHaveLength(1);
		expect(history[0]!.observedAt).toBe(2_000);
	});

	it('returns copies so callers cannot mutate internal state', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000));
		const history = store.getProviderHistory('TEST:RACE');
		history.push(observation('DDHQ', 9_999));
		expect(store.getProviderHistory('TEST:RACE')).toHaveLength(1);
	});

	it('calls onRecord hook for every observation', () => {
		const onRecord = vi.fn();
		const store = makeStore({ onRecord });
		store.record(observation('DDHQ', 1_000));
		store.record(observation('Ross', 1_001));
		expect(onRecord).toHaveBeenCalledTimes(2);
	});
});
