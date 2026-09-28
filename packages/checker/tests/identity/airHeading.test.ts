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

	it('requires every surname on the graphic to be on the ballot', () => {
		const raceKey = '2026-TX-US_House-15-NP-General_Election';
		const ballot = ['Jane Q. Smith', 'John Doe Jr.'];
		expect(
			airHeadingMatches(heading('TX-15 U.S. HOUSE'), ['JANE SMITH', 'John Doe'], raceKey, ballot),
		).toBe(true);
		expect(
			airHeadingMatches(heading('TX-15 U.S. HOUSE'), ['Jane Smith', 'Pat Other'], raceKey, ballot),
		).toBe(false);
		expect(airHeadingMatches(heading('TX-15 U.S. HOUSE'), [], raceKey, ballot)).toBe(false);
	});
});
