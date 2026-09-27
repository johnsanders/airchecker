import { describe, expect, it } from 'vitest';

import { makeSettingsStore } from '../src/settings/settingsStore.js';

describe('settings store', () => {
	it('returns an empty query list before anything is set', () => {
		const settings = makeSettingsStore(':memory:');
		expect(settings.getQueries()).toEqual([]);
		settings.close();
	});

	it('persists queries within a connection', () => {
		const settings = makeSettingsStore(':memory:');
		settings.setQueries(['race_ids=1', 'state=TX']);
		expect(settings.getQueries()).toEqual(['race_ids=1', 'state=TX']);
		settings.setQueries(['race_ids=2']);
		expect(settings.getQueries()).toEqual(['race_ids=2']);
		settings.close();
	});

	it('persists race identity state as JSON', () => {
		const settings = makeSettingsStore(':memory:');
		const state = { aliases: [{ canonicalRaceKey: 'B', source: 'air', sourceRaceKey: 'A' }] };
		settings.setIdentityState(state);
		expect(settings.getIdentityState()).toEqual(state);
		settings.close();
	});

	it('persists the air tab match, undefined until set', () => {
		const settings = makeSettingsStore(':memory:');
		expect(settings.getAirMatch()).toBeUndefined();
		settings.setAirMatch('directv');
		expect(settings.getAirMatch()).toBe('directv');
		settings.close();
	});

	it('persists the DDHQ environment, production until set', () => {
		const settings = makeSettingsStore(':memory:');
		expect(settings.getDdhqEnvironment()).toBe('production');
		settings.setDdhqEnvironment('integration');
		expect(settings.getDdhqEnvironment()).toBe('integration');
		settings.close();
	});

	it('round-trips queries through a file across reopen (survives restart)', () => {
		const path = `/tmp/eagle-eye-settings-${process.pid}.sqlite`;
		const first = makeSettingsStore(path);
		first.setQueries(['race_ids=42']);
		first.close();

		const second = makeSettingsStore(path);
		expect(second.getQueries()).toEqual(['race_ids=42']);
		second.close();
	});
});
