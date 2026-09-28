import { describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';

import defaultThresholds from '../../src/reconcile/thresholds.js';
import { makeAnomalyTracker } from '../../src/runtime/anomalyTracker.js';

const thresholds = {
	...defaultThresholds,
	airHysteresisN: 3,
	recoveryHysteresisM: 3,
	vendorHysteresisN: 2,
};

const observationAt = (source: RaceObservation['source'], observedAt: number): RaceObservation => ({
	calledFor: [],
	candidates: [],
	observedAt,
	pctIn: 0,
	raceKey: 'race',
	reportedAt: null,
	source,
});

const airAnomaly = (
	raceKey: string,
	type: Anomaly['type'],
	airObservedAt: number,
	subject?: string,
): Anomaly => ({
	detail: `${type} on ${raceKey} at ${airObservedAt}`,
	involves: { air: [observationAt('air', airObservedAt)] },
	observedAt: airObservedAt,
	owner: 'us',
	raceKey,
	severity: 'high',
	...(subject === undefined ? {} : { subject }),
	type,
});

const vendorAnomaly = (
	raceKey: string,
	type: Anomaly['type'],
	vendorObservedAt: number,
): Anomaly => ({
	detail: `${type} on ${raceKey}`,
	involves: { vendor: observationAt('Ross', vendorObservedAt) },
	observedAt: vendorObservedAt,
	owner: 'vendor',
	raceKey,
	severity: 'medium',
	type,
});

describe('anomalyTracker hysteresis', () => {
	it('starts empty', () => {
		expect(makeAnomalyTracker(thresholds).list()).toEqual([]);
	});

	it('emits an air anomaly only once N distinct air observations have shown it', () => {
		const tracker = makeAnomalyTracker(thresholds);
		expect(tracker.update('race', [airAnomaly('race', 'votes_mismatch', 1)]).raised).toEqual([]);
		// The same air frame re-reconciled because another source polled: not a sighting.
		expect(tracker.update('race', [airAnomaly('race', 'votes_mismatch', 1)]).raised).toEqual([]);
		expect(tracker.update('race', [airAnomaly('race', 'votes_mismatch', 2)]).raised).toEqual([]);
		expect(tracker.list()).toEqual([]);
		const third = tracker.update('race', [airAnomaly('race', 'votes_mismatch', 3)]);
		expect(third.raised).toHaveLength(1);
		expect(tracker.list()).toHaveLength(1);
		expect(tracker.list()[0]!.observedAt).toBe(3);
	});

	it('resets the streak when a reconcile in between is clean', () => {
		const tracker = makeAnomalyTracker(thresholds);
		tracker.update('race', [airAnomaly('race', 'votes_mismatch', 1)]);
		tracker.update('race', [airAnomaly('race', 'votes_mismatch', 2)]);
		tracker.update('race', []);
		tracker.update('race', [airAnomaly('race', 'votes_mismatch', 3)]);
		expect(tracker.update('race', [airAnomaly('race', 'votes_mismatch', 4)]).raised).toEqual([]);
		expect(tracker.list()).toEqual([]);
	});

	it('uses the vendor threshold for anomalies that do not involve air', () => {
		const tracker = makeAnomalyTracker(thresholds);
		expect(tracker.update('race', [vendorAnomaly('race', 'multiple_winners', 1)]).raised).toEqual(
			[],
		);
		expect(
			tracker.update('race', [vendorAnomaly('race', 'multiple_winners', 2)]).raised,
		).toHaveLength(1);
	});

	it('emits a vote_drop on first sight — it is a one-tick event by construction', () => {
		const tracker = makeAnomalyTracker(thresholds);
		expect(tracker.update('race', [vendorAnomaly('race', 'vote_drop', 1)]).raised).toHaveLength(1);
	});

	it('tracks per-candidate anomalies by subject, not by the volatile detail text', () => {
		const tracker = makeAnomalyTracker(thresholds);
		tracker.update('race', [airAnomaly('race', 'votes_mismatch', 1, 'Ken Paxton')]);
		tracker.update('race', [airAnomaly('race', 'votes_mismatch', 2, 'Ken Paxton')]);
		const diff = tracker.update('race', [
			airAnomaly('race', 'votes_mismatch', 3, 'Ken Paxton'),
			airAnomaly('race', 'votes_mismatch', 3, 'John Cornyn'), // first sighting for Cornyn
		]);
		expect(diff.raised.map((a) => a.subject)).toEqual(['Ken Paxton']);
	});

	it('clears an emitted anomaly after M clean reconciles and reports it', () => {
		const tracker = makeAnomalyTracker(thresholds);
		[1, 2, 3].forEach((at) => tracker.update('race', [airAnomaly('race', 'call_mismatch', at)]));
		expect(tracker.list()).toHaveLength(1);
		expect(tracker.update('race', []).cleared).toEqual([]);
		expect(tracker.update('race', []).cleared).toEqual([]);
		expect(tracker.list()).toHaveLength(1); // still standing during recovery
		const third = tracker.update('race', []);
		expect(third.cleared).toHaveLength(1);
		expect(tracker.list()).toEqual([]);
	});

	it('a reappearance during recovery keeps the anomaly standing', () => {
		const tracker = makeAnomalyTracker(thresholds);
		[1, 2, 3].forEach((at) => tracker.update('race', [airAnomaly('race', 'call_mismatch', at)]));
		tracker.update('race', []);
		tracker.update('race', []);
		expect(tracker.update('race', [airAnomaly('race', 'call_mismatch', 4)]).raised).toEqual([]);
		tracker.update('race', []);
		tracker.update('race', []);
		expect(tracker.list()).toHaveLength(1);
	});

	it('emits an air anomaly on its first sighting under the default thresholds', () => {
		const tracker = makeAnomalyTracker();
		expect(tracker.update('race', [airAnomaly('race', 'votes_mismatch', 1)]).raised).toHaveLength(
			1,
		);
	});

	it('keeps races independent and lists oldest first', () => {
		const tracker = makeAnomalyTracker(thresholds);
		tracker.update('race-a', [vendorAnomaly('race-a', 'vote_drop', 30)]);
		tracker.update('race-b', [vendorAnomaly('race-b', 'vote_drop', 10)]);
		tracker.update('race-c', [vendorAnomaly('race-c', 'vote_drop', 20)]);
		expect(tracker.list().map((a) => a.observedAt)).toEqual([10, 20, 30]);
		[1, 2, 3].forEach(() => tracker.update('race-b', []));
		expect(tracker.list().map((a) => a.raceKey)).toEqual(['race-c', 'race-a']);
	});
});
