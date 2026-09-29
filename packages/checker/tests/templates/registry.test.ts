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
});

describe('air race keys', () => {
	it('ignore the heading divider and whitespace the VLM renders inconsistently', () => {
		expect(headingRaceKey('VA | GOVERNOR')).toBe('VA GOVERNOR');
		expect(headingRaceKey('VA GOVERNOR')).toBe('VA GOVERNOR');
		expect(headingRaceKey(' CT | U.S. HOUSE (D)  DISTRICT 1 ')).toBe(
			'CT U.S. HOUSE (D) DISTRICT 1',
		);
		expect(headingRaceKey('')).toBe('');
	});

	it('drop a reporting badge the VLM dragged into the heading', () => {
		expect(headingRaceKey('AZ | U.S. HOUSE 45.IN')).toBe('AZ U.S. HOUSE');
		expect(headingRaceKey('AZ U.S. HOUSE 45 IN')).toBe('AZ U.S. HOUSE');
		expect(headingRaceKey('FL GOVERNOR >95% IN')).toBe('FL GOVERNOR');
		expect(headingRaceKey('WI | U.S. HOUSE (D) DISTRICT 7')).toBe('WI U.S. HOUSE (D) DISTRICT 7');
	});
});
