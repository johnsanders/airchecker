import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

	it('persists the mode and DDHQ host, Live on production until set', () => {
		const settings = makeSettingsStore(':memory:');
		expect(settings.getMode()).toBe('live');
		expect(settings.getDdhqHost()).toBe('production');
		settings.setMode('sim');
		settings.setDdhqHost('integration');
		expect(settings.getMode()).toBe('sim');
		expect(settings.getDdhqHost()).toBe('integration');
		settings.close();
	});

	it('reads Sim saved as the old DDHQ environment as Sim mode on production', () => {
		const dir = mkdtempSync(join(tmpdir(), 'eagle-eye-settings-'));
		const path = join(dir, 'settings.sqlite');
		const before = new Database(path);
		before.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		before.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('ddhq_environment', '"sim"');
		before.close();
		const settings = makeSettingsStore(path);
		expect(settings.getMode()).toBe('sim');
		expect(settings.getDdhqHost()).toBe('production');
		settings.setMode('live');
		expect(settings.getMode()).toBe('live');
		settings.close();
		rmSync(dir, { force: true, recursive: true });
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
