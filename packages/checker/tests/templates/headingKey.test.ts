import { describe, expect, it } from 'vitest';

import { headingRaceKey } from '../../src/templates/headingKey.js';

describe('headingRaceKey', () => {
	it('normalises the divider and casing', () => {
		expect(headingRaceKey({ race_heading: 'VA | Governor' })).toBe('VA GOVERNOR');
		expect(headingRaceKey({ race_heading: 'VA GOVERNOR' })).toBe('VA GOVERNOR');
	});

	it('strips a reporting badge dragged into the heading', () => {
		expect(headingRaceKey({ race_heading: 'AZ U.S. HOUSE 45% IN' })).toBe('AZ U.S. HOUSE');
		expect(headingRaceKey({ race_heading: 'TX U.S. SENATE (D) >95 IN' })).toBe(
			'TX U.S. SENATE (D)',
		);
	});

	it('treats a real line break and a literal backslash-n the same way', () => {
		expect(headingRaceKey({ race_heading: 'AL-2\nU.S. HOUSE' })).toBe('AL-2 U.S. HOUSE');
		expect(headingRaceKey({ race_heading: 'AL-2\\nU.S. HOUSE' })).toBe('AL-2 U.S. HOUSE');
		expect(headingRaceKey({ race_heading: 'WI U.S. HOUSE (D) \\N DISTRICT 7' })).toBe(
			'WI U.S. HOUSE (D) DISTRICT 7',
		);
	});

	it('returns an empty key when there is no heading', () => {
		expect(headingRaceKey({})).toBe('');
	});
});
