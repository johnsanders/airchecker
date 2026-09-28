import { describe, expect, it } from 'vitest';

import { headingRaceKey } from '../../src/templates/headingKey.js';
import { findTemplate, templateRegistry } from '../../src/templates/registry.js';

describe('template registry', () => {
	it('has unique template ids', () => {
		const ids = templateRegistry.map((spec) => spec.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('looks specs up by id', () => {
		expect(findTemplate('ticker_v1')?.surface).toBe('ticker');
		expect(findTemplate('nope')).toBeUndefined();
	});

	it('every candidate-list spec declares a layout and at least one field', () => {
		templateRegistry.forEach((spec) => {
			if (spec.candidateList) {
				expect(['row', 'column']).toContain(spec.candidateList.layout);
				expect(spec.candidateList.fields.length).toBeGreaterThan(0);
			}
		});
	});
});

describe('air race keys', () => {
	it('ignore the heading divider and whitespace the VLM renders inconsistently', () => {
		expect(headingRaceKey({ race_heading: 'VA | GOVERNOR' })).toBe('VA GOVERNOR');
		expect(headingRaceKey({ race_heading: 'VA GOVERNOR' })).toBe('VA GOVERNOR');
		expect(headingRaceKey({ race_heading: ' CT | U.S. HOUSE (D)  DISTRICT 1 ' })).toBe(
			'CT U.S. HOUSE (D) DISTRICT 1',
		);
		expect(headingRaceKey({})).toBe('');
	});

	it('drop a reporting badge the VLM dragged into the heading', () => {
		expect(headingRaceKey({ race_heading: 'AZ | U.S. HOUSE 45.IN' })).toBe('AZ U.S. HOUSE');
		expect(headingRaceKey({ race_heading: 'AZ U.S. HOUSE 45 IN' })).toBe('AZ U.S. HOUSE');
		expect(headingRaceKey({ race_heading: 'FL GOVERNOR >95% IN' })).toBe('FL GOVERNOR');
		expect(headingRaceKey({ race_heading: 'WI | U.S. HOUSE (D) DISTRICT 7' })).toBe(
			'WI U.S. HOUSE (D) DISTRICT 7',
		);
	});

	it('every spec keys its race from the printed heading the same way', () => {
		templateRegistry.forEach((spec) => {
			expect(spec.bind.raceKeyFrom({ race_heading: 'TX | U.S. SENATE (D)' })).toBe(
				'TX U.S. SENATE (D)',
			);
		});
	});
});
