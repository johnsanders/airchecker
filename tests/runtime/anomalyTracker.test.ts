import { describe, expect, it } from 'vitest';

import type { Anomaly } from '../../src/reconcile/reconcile.js';

import { makeAnomalyTracker } from '../../src/runtime/anomalyTracker.js';

const anomaly = (raceKey: string, type: Anomaly['type'], observedAt: number): Anomaly => ({
	detail: `${type} on ${raceKey}`,
	involves: {},
	observedAt,
	owner: 'observe',
	raceKey,
	severity: 'high',
	type,
});

describe('anomalyTracker', () => {
	it('starts empty', () => {
		expect(makeAnomalyTracker().list()).toEqual([]);
	});

	it('replaces a race’s anomalies on update instead of appending', () => {
		const tracker = makeAnomalyTracker();
		const race = '2026-TX-US_Senate-AL-Republican-Primary';
		tracker.update(race, [anomaly(race, 'votes_mismatch', 1)]);
		tracker.update(race, [anomaly(race, 'votes_mismatch', 2)]); // same standing anomaly, re-reconciled
		const list = tracker.list();
		expect(list).toHaveLength(1);
		expect(list[0]!.observedAt).toBe(2);
	});

	it('clears a race when it reconciles clean', () => {
		const tracker = makeAnomalyTracker();
		const race = '2026-TX-US_Senate-AL-Republican-Primary';
		tracker.update(race, [anomaly(race, 'call_mismatch', 1)]);
		tracker.update(race, []);
		expect(tracker.list()).toEqual([]);
	});

	it('keeps anomalies from different races independent', () => {
		const tracker = makeAnomalyTracker();
		tracker.update('race-a', [anomaly('race-a', 'votes_mismatch', 1)]);
		tracker.update('race-b', [anomaly('race-b', 'pct_in_mismatch', 2)]);
		tracker.update('race-a', []); // a resolves, b stays
		const list = tracker.list();
		expect(list).toHaveLength(1);
		expect(list[0]!.raceKey).toBe('race-b');
	});

	it('lists oldest first so a downstream slice(-n).reverse() is newest-first', () => {
		const tracker = makeAnomalyTracker();
		tracker.update('race-a', [anomaly('race-a', 'votes_mismatch', 30)]);
		tracker.update('race-b', [anomaly('race-b', 'pct_in_mismatch', 10)]);
		tracker.update('race-c', [anomaly('race-c', 'call_mismatch', 20)]);
		expect(tracker.list().map((a) => a.observedAt)).toEqual([10, 20, 30]);
	});
});
