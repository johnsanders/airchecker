import { describe, expect, it } from 'vitest';

import type { Anomaly, RaceObservation } from '../../src/reconcile/reconcile.js';
import type { AlertEvent } from '../../src/runtime/alertLog.js';

import { makeAlertLog } from '../../src/runtime/alertLog.js';

const anomaly = (raceKey: string, subject?: string): Anomaly => ({
	detail: `votes_mismatch on ${raceKey}`,
	involves: {},
	observedAt: 1,
	owner: 'us',
	raceKey,
	severity: 'high',
	...(subject === undefined ? {} : { subject }),
	type: 'votes_mismatch',
});

describe('alertLog', () => {
	it('turns a tracker diff into raised/cleared events, newest first, and notifies', () => {
		const seen: AlertEvent[] = [];
		const log = makeAlertLog({ onEvent: (event) => seen.push(event) });
		log.record({ cleared: [], raised: [anomaly('race-a', 'Ken Paxton')] }, 100);
		log.record({ cleared: [anomaly('race-a', 'Ken Paxton')], raised: [anomaly('race-b')] }, 200);
		expect(log.recent().map((e) => [e.kind, e.raceKey, e.ts])).toEqual([
			['cleared', 'race-a', 200],
			['raised', 'race-b', 200],
			['raised', 'race-a', 100],
		]);
		expect(log.recent()[2]!.subject).toBe('Ken Paxton');
		expect(seen).toHaveLength(3);
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
		const raised = { ...anomaly('race-a', 'Greg Abbott'), involves: { vendor: ross } };
		const log = makeAlertLog();
		log.record({ cleared: [], raised: [raised] }, 100);
		ross.candidates[0]!.votes = 2000;
		log.record({ cleared: [raised], raised: [] }, 200);
		const [cleared, raise] = log.recent();
		expect(raise!.evidence?.vendor?.candidates[0]!.votes).toBe(1000);
		expect(cleared!.evidence).toBeUndefined();
	});

	it('is bounded by capacity and honors the recent limit', () => {
		const log = makeAlertLog({ capacity: 3 });
		[1, 2, 3, 4, 5].forEach((ts) => log.record({ cleared: [], raised: [anomaly(`r${ts}`)] }, ts));
		expect(log.recent().map((e) => e.ts)).toEqual([5, 4, 3]);
		expect(log.recent(2).map((e) => e.ts)).toEqual([5, 4]);
	});

	it('records nothing for an empty diff', () => {
		const log = makeAlertLog();
		expect(log.record({ cleared: [], raised: [] }, 1)).toEqual([]);
		expect(log.recent()).toEqual([]);
	});
});
