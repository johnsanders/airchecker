import { describe, expect, it } from 'vitest';

import type { RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';

import { linkObservation } from '../../src/identity/linkRace.js';

const TX15 = '2026-TX-US_House-15-NP-General_Election';
const TX16 = '2026-TX-US_House-16-NP-General_Election';

const observation = (
	source: SourceName,
	raceKey: string,
	names: string[],
	extra: Partial<RaceObservation> = {},
): RaceObservation => ({
	calledFor: [],
	candidates: names.map((name) => ({ key: name, name, party: 'D', pct: 50, votes: 100 })),
	observedAt: 1_000,
	pctIn: 50,
	raceKey,
	reportedAt: null,
	source,
	...extra,
});

const reported = [
	observation('DDHQ', TX15, ['Bobby Pulido', 'Monica De La Cruz'], { providerRaceId: '15' }),
	observation('DDHQ', TX16, ['Veronica Escobar', 'Irene Armendariz'], { providerRaceId: '16' }),
];
const races = { provider: reported, vendor: [] };
const none = { provider: [], vendor: [] };

describe('linkObservation', () => {
	it('leaves a DDHQ race under its own key', () =>
		expect(linkObservation(reported[0]!, none)).toMatchObject({
			raceKey: TX15,
			sourceRaceKey: TX15,
		}));

	it('puts a Ross contest under the DDHQ race it names by race_id, whatever its own key says', () => {
		const ross = observation('Ross', '2026-TX-US_House-15-NP-General', [], {
			providerRaceId: '15',
		});
		expect(linkObservation(ross, races)).toMatchObject({
			raceKey: TX15,
			sourceRaceKey: '2026-TX-US_House-15-NP-General',
		});
	});

	it('leaves a Ross contest under its own key when it names no race DDHQ has reported', () => {
		const unnamed = observation('Ross', TX15, []);
		const unknown = observation('Ross', TX15, [], { providerRaceId: '99' });
		expect(linkObservation(unnamed, races).raceKey).toBe(TX15);
		expect(linkObservation(unknown, races).raceKey).toBe(TX15);
		expect(linkObservation(unknown, none).raceKey).toBe(TX15);
	});

	it('links an air read to the one DDHQ race its heading and surnames fit', () => {
		const fullscreen = observation('air', 'TX-15 U.S. HOUSE', [
			'BOBBY PULIDO',
			'MONICA DE LA CRUZ',
		]);
		const ticker = observation('air', 'TX U.S. HOUSE DISTRICT 15', [
			'Bobby Pulido',
			'Monica De La Cruz',
		]);
		[fullscreen, ticker].forEach((air) =>
			expect(linkObservation(air, races)).toMatchObject({
				providerRaceId: '15',
				raceKey: TX15,
				sourceRaceKey: air.raceKey,
			}),
		);
	});

	it('leaves an air read unlinked when its heading fits no race, or a misread one', () => {
		const misread = observation('air', 'TX-16 U.S. HOUSE', ['Bobby Pulido', 'Monica De La Cruz']);
		const notARace = observation('air', 'DECISION DESK26', ['Bobby Pulido']);
		const beforeDdhq = observation('air', 'TX-15 U.S. HOUSE', ['Bobby Pulido']);
		[
			linkObservation(misread, races),
			linkObservation(notARace, races),
			linkObservation(beforeDdhq, none),
		].forEach((linked) => {
			expect(linked.raceKey).toBe(linked.sourceRaceKey);
			expect(linked.providerRaceId).toBeUndefined();
		});
	});

	it('leaves an air read unlinked when more than one race fits', () => {
		const runoff = observation('DDHQ', '2026-TX-US_Senate-AL-Republican-Runoff', [
			'Ken Paxton',
			'John Cornyn',
		]);
		const primary = observation('DDHQ', '2026-TX-US_Senate-AL-Republican-Primary', [
			'Ken Paxton',
			'John Cornyn',
			'Wesley Hunt',
		]);
		const air = observation('air', 'TX U.S. SENATE (R)', ['Ken Paxton', 'John Cornyn']);
		const both = { provider: [runoff, primary], vendor: [] };
		expect(linkObservation(air, both).raceKey).toBe('TX U.S. SENATE (R)');
		expect(linkObservation(air, { provider: [runoff], vendor: [] }).raceKey).toBe(runoff.raceKey);
	});

	it('falls back to a race only Ross has reported, when no DDHQ race fits', () => {
		const rossOnly = observation('Ross', TX15, ['Bobby Pulido', 'Monica De La Cruz'], {
			providerRaceId: '15',
		});
		const air = observation('air', 'TX-15 U.S. HOUSE', ['Bobby Pulido', 'Monica De La Cruz']);
		expect(linkObservation(air, { provider: [], vendor: [rossOnly] })).toMatchObject({
			providerRaceId: '15',
			raceKey: TX15,
		});
		expect(linkObservation(air, { provider: [reported[1]!], vendor: [rossOnly] }).raceKey).toBe(
			TX15,
		);
	});

	it('links afresh from the source key, whatever race a recording filed the observation under', () => {
		const recorded = observation('air', 'provisional:air:TX-15-U-S-HOUSE', ['Bobby Pulido'], {
			providerRaceId: '16',
			sourceRaceKey: 'TX-15 U.S. HOUSE',
		});
		expect(linkObservation(recorded, races)).toMatchObject({ providerRaceId: '15', raceKey: TX15 });
		expect(linkObservation(recorded, none)).toMatchObject({ raceKey: 'TX-15 U.S. HOUSE' });
		expect(linkObservation(recorded, none).providerRaceId).toBeUndefined();
	});
});
