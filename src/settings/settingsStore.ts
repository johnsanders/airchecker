import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Persistent config that must outlive a single run — unlike the recorder DB, whose
// file is session-scoped (a fresh one per launch). A tiny key/value table in a
// fixed-path SQLite file so things like the DDHQ query list survive restarts.
// Values are JSON; one helper pair per persisted key.
export type SettingsStore = {
	close: () => void;
	getAirMatch: () => string | undefined;
	getIdentityState: () => undefined | unknown;
	getQueries: () => string[];
	setAirMatch: (match: string) => void;
	setIdentityState: (state: unknown) => void;
	setQueries: (queries: string[]) => void;
};

const AIR_MATCH_KEY = 'air_match';
const IDENTITY_KEY = 'race_identity_state_v1';
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

	const getIdentityState = (): undefined | unknown => {
		const row = selectValue.get(IDENTITY_KEY) as { value: string } | undefined;
		return row === undefined ? undefined : (JSON.parse(row.value) as unknown);
	};

	return {
		close: () => db.close(),
		getAirMatch,
		getIdentityState,
		getQueries,
		setAirMatch: (match) => upsertValue.run(AIR_MATCH_KEY, JSON.stringify(match)),
		setIdentityState: (state) => upsertValue.run(IDENTITY_KEY, JSON.stringify(state)),
		setQueries: (queries) => upsertValue.run(QUERIES_KEY, JSON.stringify(queries)),
	};
};
