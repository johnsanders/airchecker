import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
	adaptRace,
	adaptResponse,
	buildCandidateName,
	buildRaceKey,
	partyLetter,
} from '../src/sources/provider/adapter.js';
import {
	type DdhqCandidate,
	type DdhqRace,
	ddhqResponseSchema,
} from '../src/sources/provider/ddhqSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, '..', 'ddhq_response_example.json');
const sampleJson = JSON.parse(readFileSync(samplePath, 'utf8')) as unknown;

describe('DDHQ schema', () => {
	it('parses the example response without errors', () => {
		const parsed = ddhqResponseSchema.safeParse(sampleJson);
		expect(parsed.success).toBe(true);
	});
});

describe('buildRaceKey', () => {
	it('produces a stable composite key from political dimensions', () => {
		const race = ddhqResponseSchema.parse(sampleJson).data[0]!;
		expect(buildRaceKey(race)).toBe('2024-TX-US_House-1-NP-General_Election');
	});

	it('uses AL for at-large races', () => {
		const race = { ...sampleRace(), district: null };
		expect(buildRaceKey(race)).toContain('-AL-');
	});

	it('uses NP for nonpartisan races', () => {
		const race = { ...sampleRace(), party: null };
		expect(buildRaceKey(race)).toContain('-NP-');
	});
});

describe('buildCandidateName', () => {
	it('joins first + last when middle/suffix/preferred are empty', () => {
		const candidate = {
			...sampleCandidate(),
			first_name: 'Al',
			last_name: 'Green',
			middle_name: null,
			preferred_name: null,
			suffix: null,
		};
		expect(buildCandidateName(candidate)).toBe('Al Green');
	});

	it('skips empty-string fields the same way as null', () => {
		const candidate = {
			...sampleCandidate(),
			first_name: 'Christian',
			last_name: 'Menefee',
			middle_name: '',
			preferred_name: '',
			suffix: '',
		};
		expect(buildCandidateName(candidate)).toBe('Christian Menefee');
	});

	it('uses preferred_name when present', () => {
		const candidate = {
			...sampleCandidate(),
			first_name: 'Robert',
			last_name: 'Smith',
			middle_name: null,
			preferred_name: 'Bob',
		};
		expect(buildCandidateName(candidate)).toBe('Bob Smith');
	});
});

describe('partyLetter', () => {
	it.each([
		['Democratic', 'D'],
		['Republican', 'R'],
		['Libertarian', 'L'],
		['Green', 'G'],
		['Independent', 'I'],
		['Working Families', 'W'],
	])('maps %s to %s', (input, expected) => {
		expect(partyLetter(input)).toBe(expected);
	});
});

describe('adaptRace', () => {
	it('produces a RaceObservation that the reconciler can consume', () => {
		const race = ddhqResponseSchema.parse(sampleJson).data[1]!;
		const observed = adaptRace(race, 1_700_000_000_000);
		expect(observed.source).toBe('DDHQ');
		expect(observed.raceKey).toBe('2024-TX-US_House-2-NP-General_Election');
		expect(observed.observedAt).toBe(1_700_000_000_000);
		expect(observed.reportedAt).toBe(Date.parse('2026-04-10T17:28:48.504Z'));
		expect(observed.pctIn).toBe(95); // estimated_votes.turnout_mid, not precincts.percent (0)
		expect(observed.calledFor).toEqual(['85131']);
		expect(observed.candidates).toHaveLength(2);

		const filler = observed.candidates.find((c) => c.key === '52726');
		const crenshaw = observed.candidates.find((c) => c.key === '85131');
		expect(filler?.name).toBe('Peter Filler');
		expect(filler?.votes).toBe(112252);
		expect(filler?.party).toBe('D');
		expect(crenshaw?.name).toBe('Daniel Crenshaw');
		expect(crenshaw?.votes).toBe(214631);
		expect(crenshaw?.party).toBe('R');
	});

	it('computes candidate pct as a percentage of total_votes', () => {
		const race = ddhqResponseSchema.parse(sampleJson).data[1]!;
		const observed = adaptRace(race, 0);
		const crenshaw = observed.candidates.find((c) => c.key === '85131')!;
		expect(crenshaw.pct).toBeCloseTo((214631 / 326883) * 100, 4);
	});

	it('reports calledFor as all called candidate ids stringified', () => {
		const race: DdhqRace = {
			...sampleRace(),
			topline_results: {
				...sampleRace().topline_results,
				called_candidates: [12345, 67890],
			},
		};
		const observed = adaptRace(race, 0);
		expect(observed.calledFor).toEqual(['12345', '67890']);
	});
});

describe('adaptResponse', () => {
	it('produces one observation per race in the response', () => {
		const response = ddhqResponseSchema.parse(sampleJson);
		const observations = adaptResponse(response, 1_700_000_000_000);
		expect(observations).toHaveLength(response.data.length);
	});
});

const sampleRace = (): DdhqRace => ddhqResponseSchema.parse(sampleJson).data[0]!;

const sampleCandidate = (): DdhqCandidate => sampleRace().candidates[0]!;

// The September 2026 General sample (page 1 of race_date=2026-11-03&state=TX&
// office_id=3, DDHQ test_data races): pre-election precinct counts are null.
const generalPath = resolve(here, '..', 'ddhq_response_general_example.json');
const generalJson = JSON.parse(readFileSync(generalPath, 'utf8')) as unknown;

describe('DDHQ General Election sample', () => {
	it('parses the pre-election response (null precinct percent) without errors', () => {
		const parsed = ddhqResponseSchema.safeParse(generalJson);
		if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
		expect(parsed.data.data).toHaveLength(10);
		expect(parsed.data.data.some((race) => race.topline_results.precincts.percent === null)).toBe(
			true,
		);
	});

	it('adapts pre-election races (null precinct percent, turnout_mid 0) to pctIn 0', () => {
		const response = ddhqResponseSchema.parse(generalJson);
		const observations = adaptResponse(response, 1_000);
		const nullPercent = response.data.filter(
			(race) => race.topline_results.precincts.percent === null,
		);
		expect(nullPercent.length).toBeGreaterThan(0);
		nullPercent.forEach((race) => {
			const observation = observations.find((o) => o.raceKey === buildRaceKey(race));
			expect(observation?.pctIn).toBe(0);
		});
	});

	it('keys a General Election House race with NP party and the district', () => {
		const response = ddhqResponseSchema.parse(generalJson);
		const tx9 = response.data.find((race) => race.race_id === 295078);
		expect(tx9 && buildRaceKey(tx9)).toBe('2026-TX-US_House-9-NP-General_Election');
	});
});

describe('pctIn follows DDHQ reporting_type', () => {
	it('uses estimated_votes.turnout_mid for estimated races (precincts.percent is 0 on the 2024 sample)', () => {
		const race = ddhqResponseSchema.parse(sampleJson).data[1]!;
		expect(race.reporting_type).toBe('estimated');
		expect(race.topline_results.precincts.percent).toBe(0);
		expect(race.topline_results.estimated_votes?.turnout_mid).toBe(95);
		expect(adaptRace(race, 0).pctIn).toBe(95);
	});

	it('uses precincts.percent for precinct-reporting (municipal) races', () => {
		const race = ddhqResponseSchema.parse(sampleJson).data[1]!;
		const municipal: DdhqRace = {
			...race,
			reporting_type: 'precincts',
			topline_results: {
				...race.topline_results,
				precincts: { percent: 42.5, reporting: 17, total: 40 },
			},
		};
		expect(adaptRace(municipal, 0).pctIn).toBe(42.5);
	});
});
