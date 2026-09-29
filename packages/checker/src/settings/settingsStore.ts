import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DdhqHost, Mode } from '../sources/provider/providerSource.js';

// Persistent config that must outlive a single run — unlike the recorder DB, whose
// file is session-scoped (a fresh one per launch). A tiny key/value table in a
// fixed-path SQLite file so things like the DDHQ query list survive restarts.
// Values are JSON; one helper pair per persisted key.
export type SettingsStore = {
	close: () => void;
	getAirMatch: () => string | undefined;
	getDdhqHost: () => DdhqHost;
	getMode: () => Mode;
	getQueries: () => string[];
	setAirMatch: (match: string) => void;
	setDdhqHost: (host: DdhqHost) => void;
	setMode: (mode: Mode) => void;
	setQueries: (queries: string[]) => void;
};

const AIR_MATCH_KEY = 'air_match';
// Holds the DDHQ host. It once held 'sim' too, before Sim became a mode of its own.
const DDHQ_ENVIRONMENT_KEY = 'ddhq_environment';
const MODE_KEY = 'mode';
const QUERIES_KEY = 'ddhq_queries';

export const makeSettingsStore = (path: string): SettingsStore => {
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

	const db = new Database(path);
	db.pragma('journal_mode = WAL');
	db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');

	const selectValue = db.prepare('SELECT value FROM kv WHERE key = ?');
	const upsertValue = db.prepare(
		'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
	);

	const getQueries = (): string[] => {
		const row = selectValue.get(QUERIES_KEY) as { value: string } | undefined;
		if (row === undefined) return [];
		const parsed = JSON.parse(row.value) as unknown;
		return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : [];
	};

	const getAirMatch = (): string | undefined => {
		const row = selectValue.get(AIR_MATCH_KEY) as { value: string } | undefined;
		if (row === undefined) return undefined;
		const parsed = JSON.parse(row.value) as unknown;
		return typeof parsed === 'string' ? parsed : undefined;
	};

	const readJson = (key: string): unknown => {
		const row = selectValue.get(key) as { value: string } | undefined;
		return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
	};

	const getDdhqHost = (): DdhqHost =>
		readJson(DDHQ_ENVIRONMENT_KEY) === 'integration' ? 'integration' : 'production';

	// Before there was a mode, Sim was saved as the DDHQ environment.
	const getMode = (): Mode => {
		const mode = readJson(MODE_KEY) ?? readJson(DDHQ_ENVIRONMENT_KEY);
		return mode === 'sim' ? 'sim' : 'live';
	};

	return {
		close: () => db.close(),
		getAirMatch,
		getDdhqHost,
		getMode,
		getQueries,
		setAirMatch: (match) => upsertValue.run(AIR_MATCH_KEY, JSON.stringify(match)),
		setDdhqHost: (host) => upsertValue.run(DDHQ_ENVIRONMENT_KEY, JSON.stringify(host)),
		setMode: (mode) => upsertValue.run(MODE_KEY, JSON.stringify(mode)),
		setQueries: (queries) => upsertValue.run(QUERIES_KEY, JSON.stringify(queries)),
	};
};
