import { describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';
import type { AlertEvent } from '../../src/runtime/alertLog.js';

import { makeAlertLog } from '../../src/runtime/alertLog.js';

const read = (raceKey: string, observedAt: number, templateId = 'ticker_v1'): RaceObservation => ({
	calledFor: [],
	candidates: [],
	observedAt,
	pctIn: 0,
	raceKey,
	reportedAt: null,
	source: 'air',
	templateId,
});

const anomaly = (raceKey: string, subject?: string, detail = 'votes differ'): Anomaly => ({
	detail,
	involves: {},
	observedAt: 1,
	owner: 'us',
	raceKey,
	severity: 'high',
	...(subject === undefined ? {} : { subject }),
	type: 'votes_mismatch',
});

describe('alertLog', () => {
	it('raises what a read found that the last read of that graphic did not, and clears what it no longer finds', () => {
		const seen: AlertEvent[] = [];
		const log = makeAlertLog({ onEvent: (event) => seen.push(event) });
		log.record(read('race-a', 100), [anomaly('race-a', 'Ken Paxton')]);
		// Still wrong on the next capture, by a different amount and in the read's own spelling
		// of the name: the same alert, not a new one.
		expect(log.record(read('race-a', 150), [anomaly('race-a', 'KEN PAXTON', 'other')])).toEqual([]);
		log.record(read('race-b', 200), [anomaly('race-b')]);
		log.record(read('race-a', 300), []);
		expect(log.recent().map((e) => [e.kind, e.raceKey, e.ts])).toEqual([
			['cleared', 'race-a', 300],
			['raised', 'race-b', 200],
			['raised', 'race-a', 100],
		]);
		expect(log.recent()[2]!.subject).toBe('Ken Paxton');
		expect(seen).toHaveLength(3);
	});

	it('keeps a race on two graphics apart: a clean ticker does not clear a bad lower third', () => {
		const log = makeAlertLog();
		log.record(read('race-a', 100, 'lower_third'), [anomaly('race-a')]);
		expect(log.record(read('race-a', 100, 'ticker_v1'), [])).toEqual([]);
		expect(log.record(read('race-a', 200, 'lower_third'), []).map((e) => e.kind)).toEqual([
			'cleared',
		]);
	});

	it('keeps the evidence of a raise as it was, whatever happens to the observations later', () => {
		const ross: RaceObservation = {
			calledFor: [],
			candidates: [{ key: 'c1', name: 'Greg Abbott', party: 'R', pct: 55, votes: 1000 }],
			observedAt: 50,
			pctIn: 40,
			raceKey: 'race-a',
			reportedAt: null,
			source: 'Ross',
		};
		const log = makeAlertLog();
		log.record(read('race-a', 100), [
			{ ...anomaly('race-a', 'Greg Abbott'), involves: { vendor: ross } },
		]);
		ross.candidates[0]!.votes = 2000;
		log.record(read('race-a', 200), []);
		const [cleared, raise] = log.recent();
		expect(raise!.evidence?.vendor?.candidates[0]!.votes).toBe(1000);
		expect(cleared!.evidence).toBeUndefined();
	});

	it('is bounded by capacity and honors the recent limit', () => {
		const log = makeAlertLog({ capacity: 3 });
		[1, 2, 3, 4, 5].forEach((ts) => log.record(read(`r${ts}`, ts), [anomaly(`r${ts}`)]));
		expect(log.recent().map((e) => e.ts)).toEqual([5, 4, 3]);
		expect(log.recent(2).map((e) => e.ts)).toEqual([5, 4]);
	});

	it('records nothing for a clean read of a clean race', () => {
		const log = makeAlertLog();
		expect(log.record(read('race-a', 1), [])).toEqual([]);
		expect(log.recent()).toEqual([]);
	});
});
