import { describe, expect, it, vi } from 'vitest';

import type { RaceObservation, SourceName } from '../src/reconcile/reconcile.js';

import makeStore from '../src/store/store.js';

const observation = (
	source: SourceName,
	at: number,
	options: { raceKey?: string; votes?: number } = {},
): RaceObservation => ({
	calledFor: [],
	candidates: [{ key: 'A', name: 'Jane Smith', party: 'D', pct: 50, votes: options.votes ?? 100 }],
	observedAt: at,
	pctIn: 50,
	raceKey: options.raceKey ?? 'TEST:RACE',
	reportedAt: null,
	source,
});

const times = (history: RaceObservation[]): number[] => history.map((entry) => entry.observedAt);

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
		store.record(observation('DDHQ', 1_000, { raceKey: 'RACE:A' }));
		store.record(observation('DDHQ', 1_001, { raceKey: 'RACE:B' }));
		expect(store.getProviderHistory('RACE:A')).toHaveLength(1);
		expect(store.getProviderHistory('RACE:B')).toHaveLength(1);
		expect(store.getProviderHistory('RACE:C')).toHaveLength(0);
	});

	it('returns the union of race keys across sources without duplicates', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000, { raceKey: 'RACE:A' }));
		store.record(observation('Ross', 1_001, { raceKey: 'RACE:A' }));
		store.record(observation('air', 1_002, { raceKey: 'RACE:B' }));
		expect(store.getRaceKeys().sort()).toEqual(['RACE:A', 'RACE:B']);
	});

	it('keeps what DDHQ and Ross say only when it changes, stamped when first seen', () => {
		const onRecord = vi.fn();
		const store = makeStore({ onRecord });
		(['DDHQ', 'Ross'] as const).forEach((source) => {
			expect(store.record(observation(source, 1_000))?.observedAt).toBe(1_000);
			expect(store.record(observation(source, 2_000))).toBeUndefined();
			expect(store.record(observation(source, 3_000, { votes: 101 }))?.observedAt).toBe(3_000);
			expect(store.record(observation(source, 4_000, { votes: 101 }))).toBeUndefined();
			expect(times(store.getHistory(source, 'TEST:RACE'))).toEqual([1_000, 3_000]);
		});
		expect(onRecord).toHaveBeenCalledTimes(4);
	});

	it('keeps every air read, the same figures or not', () => {
		const store = makeStore();
		store.record(observation('air', 1_000));
		store.record(observation('air', 2_000));
		expect(times(store.getAirHistory('TEST:RACE'))).toEqual([1_000, 2_000]);
	});

	it('drops air reads older than retentionMs', () => {
		const store = makeStore({ retentionMs: 1_000 });
		store.record(observation('air', 0));
		store.record(observation('air', 500));
		store.record(observation('air', 1_500));
		expect(times(store.getAirHistory('TEST:RACE'))).toEqual([500, 1_500]);
		store.record(observation('air', 5_000, { raceKey: 'OTHER' }));
		expect(store.getRaceKeys()).toEqual(['OTHER']);
	});

	it('keeps the last thing DDHQ and Ross said, however old, and what it replaced for a while', () => {
		const minute = 60_000;
		const store = makeStore({ retentionMs: 30 * minute });
		store.record(observation('Ross', 0, { votes: 1 }));
		store.record(observation('Ross', 10 * minute, { votes: 2 }));
		store.record(observation('Ross', 20 * minute, { votes: 3 }));
		// An air read 50 minutes in: reads live 30 minutes and the sources 5 more, so 15:00 is
		// the cutoff. What Ross said at 10:00 still stood then; what it said at 0:00 did not.
		store.record(observation('air', 50 * minute));
		expect(times(store.getVendorHistory('TEST:RACE'))).toEqual([10 * minute, 20 * minute]);
		// Hours later Ross has said nothing new: the last thing it said is still what it says.
		store.record(observation('air', 500 * minute));
		expect(times(store.getVendorHistory('TEST:RACE'))).toEqual([20 * minute]);
	});

	it('returns copies so callers cannot mutate internal state', () => {
		const store = makeStore();
		store.record(observation('DDHQ', 1_000));
		const history = store.getProviderHistory('TEST:RACE');
		history.push(observation('DDHQ', 9_999));
		expect(store.getProviderHistory('TEST:RACE')).toHaveLength(1);
	});
});
