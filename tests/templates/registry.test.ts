import { describe, expect, it } from 'vitest';

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
