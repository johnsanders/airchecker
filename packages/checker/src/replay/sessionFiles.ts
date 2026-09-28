import Database from 'better-sqlite3';
import { existsSync, readdirSync, rmSync, statfsSync, statSync } from 'node:fs';
import { join } from 'node:path';

// What recorded sessions hold and cost on disk, plus pruning a session's frame PNGs
// or deleting a session outright.
// Frames are the bulk (~1 GB per broadcast hour at the default cadence); the sqlite
// keeps the observations, LLM calls, identity and alert events, so a pruned session
// still replays and freezes — only capture-golden --from-session needs the PNGs.

export type DiskUsage = { freeBytes: number; totalBytes: number };

export type SessionFiles = {
	// Removes the sqlite (with its -wal/-shm) and the session folder. Returns the bytes
	// freed. Throws for an unknown id or the session being recorded.
	deleteSession: (id: string) => number;
	disk: () => DiskUsage;
	list: () => SessionSummary[];
	// Returns the bytes freed. Throws for an unknown id or the session being recorded.
	pruneFrames: (id: string) => number;
};

export type SessionSummary = {
	alerts: number;
	current: boolean;
	endedAt: null | number;
	frames: number;
	framesBytes: number;
	id: string;
	observations: number;
	sqliteBytes: number;
	startedAt: null | number;
};

const dirSize = (path: string): number =>
	existsSync(path)
		? readdirSync(path, { withFileTypes: true }).reduce((total, entry) => {
				const full = join(path, entry.name);
				return total + (entry.isDirectory() ? dirSize(full) : statSync(full).size);
			}, 0)
		: 0;

const fileSize = (path: string): number => (existsSync(path) ? statSync(path).size : 0);

const hasTable = (db: Database.Database, table: string): boolean =>
	db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
	undefined;

const countRows = (db: Database.Database, table: string): number =>
	hasTable(db, table)
		? (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
		: 0;

export const makeSessionFiles = (
	baseDir: string,
	currentSessionId: () => string | undefined = () => undefined,
): SessionFiles => {
	const sessionIds = (): string[] =>
		existsSync(baseDir)
			? readdirSync(baseDir)
					.filter((file) => file.endsWith('.sqlite') && file !== 'settings.sqlite')
					.map((file) => file.replace(/\.sqlite$/, ''))
					.sort()
			: [];

	const summarize = (id: string): SessionSummary => {
		const db = new Database(join(baseDir, `${id}.sqlite`), { fileMustExist: true, readonly: true });
		const session = hasTable(db, 'sessions')
			? (db.prepare('SELECT started_at, ended_at FROM sessions WHERE id = ?').get(id) as
					{ ended_at: null | number; started_at: number } | undefined)
			: undefined;
		const summary = {
			alerts: countRows(db, 'alert_events'),
			current: id === currentSessionId(),
			endedAt: session?.ended_at ?? null,
			frames: countRows(db, 'frames'),
			framesBytes: dirSize(join(baseDir, id, 'frames')),
			id,
			observations: countRows(db, 'observations'),
			sqliteBytes:
				fileSize(join(baseDir, `${id}.sqlite`)) + fileSize(join(baseDir, `${id}.sqlite-wal`)),
			startedAt: session?.started_at ?? null,
		};
		db.close();
		return summary;
	};

	// The id comes from the web request, so only a listed session name is accepted.
	const assertDeletable = (id: string): void => {
		if (!sessionIds().includes(id)) throw new Error(`no session ${id}`);
		if (id === currentSessionId()) throw new Error(`session ${id} is being recorded`);
	};

	return {
		deleteSession: (id) => {
			assertDeletable(id);
			const files = ['.sqlite', '.sqlite-wal', '.sqlite-shm'].map((suffix) =>
				join(baseDir, `${id}${suffix}`),
			);
			const sessionDir = join(baseDir, id);
			const freed = files.reduce((total, file) => total + fileSize(file), 0) + dirSize(sessionDir);
			files.forEach((file) => rmSync(file, { force: true }));
			rmSync(sessionDir, { force: true, recursive: true });
			return freed;
		},
		disk: () => {
			const stats = statfsSync(existsSync(baseDir) ? baseDir : '.');
			return { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
		},
		list: () => sessionIds().map(summarize),
		pruneFrames: (id) => {
			assertDeletable(id);
			const framesDir = join(baseDir, id, 'frames');
			const freed = dirSize(framesDir);
			rmSync(framesDir, { force: true, recursive: true });
			return freed;
		},
	};
};
