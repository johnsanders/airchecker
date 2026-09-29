import { describe, expect, it } from 'vitest';

import { airHeadingMatches, parseAirHeading } from '../../src/identity/airHeading.js';

const NAMES = ['Jane Smith', 'John Doe'];

describe('parseAirHeading', () => {
	it('reads state, district, office and party from a heading key', () => {
		expect(parseAirHeading('TX-15 U.S. HOUSE')).toEqual({
			district: '15',
			office: 'USHOUSE',
			party: 'NP',
			state: 'TX',
		});
		expect(parseAirHeading('OK U.S. SENATE')).toMatchObject({ district: 'AL', office: 'USSENATE' });
		expect(parseAirHeading('TX U.S. SENATE (D)')).toMatchObject({ party: 'D' });
		expect(parseAirHeading('NE GOVERNOR')).toMatchObject({ office: 'GOVERNOR', state: 'NE' });
	});

	it('reads the district from the second line the ticker prints', () => {
		expect(parseAirHeading('WI U.S. HOUSE (D) DISTRICT 7')).toEqual({
			district: '7',
			office: 'USHOUSE',
			party: 'D',
			state: 'WI',
		});
		expect(parseAirHeading('MN U.S. HOUSE DISTRICT 2')).toEqual({
			district: '2',
			office: 'USHOUSE',
			party: 'NP',
			state: 'MN',
		});
	});

	it('refuses a heading that does not start with a state', () =>
		expect(parseAirHeading('BREAKING NEWS')).toBeUndefined());
});

describe('airHeadingMatches', () => {
	const heading = (key: string) => parseAirHeading(key) ?? expect.fail(`unparsed ${key}`);

	it('matches the DDHQ race with the same state, office, district and party', () => {
		expect(
			airHeadingMatches(
				heading('TX-15 U.S. HOUSE'),
				NAMES,
				'2026-TX-US_House-15-NP-General_Election',
				NAMES,
			),
		).toBe(true);
		expect(
			airHeadingMatches(
				heading('TX U.S. SENATE (D)'),
				NAMES,
				'2026-TX-US_Senate-AL-Democratic-Primary',
				NAMES,
			),
		).toBe(true);
	});

	it('rejects another district, office, party or state', () =>
		[
			'2026-TX-US_House-16-NP-General_Election',
			'2026-TX-US_Senate-AL-NP-General_Election',
			'2026-TX-US_House-15-Republican-Primary',
			'2026-OK-US_House-15-NP-General_Election',
		].forEach((raceKey) =>
			expect(airHeadingMatches(heading('TX-15 U.S. HOUSE'), NAMES, raceKey, NAMES)).toBe(false),
		));

	it('requires a surname on the graphic to be on the ballot', () => {
		const raceKey = '2026-TX-US_House-15-NP-General_Election';
		const ballot = ['Jane Q. Smith', 'John Doe Jr.'];
		const matches = (names: string[]): boolean =>
			airHeadingMatches(heading('TX-15 U.S. HOUSE'), names, raceKey, ballot);
		expect(matches(['JANE SMITH', 'John Doe'])).toBe(true);
		// One name misspelled on the graphic: still this race, where it will be flagged.
		expect(matches(['Jane Smyth', 'John Doe'])).toBe(true);
		// Another race's candidates under a misread district.
		expect(matches(['Pat Other', 'Sam Else'])).toBe(false);
		expect(matches([])).toBe(false);
	});
});
