import { describe, expect, it } from 'vitest';

import type { Anomaly } from '../../src/reconcile/reconcile.js';
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
