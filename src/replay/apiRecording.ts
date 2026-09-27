import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

// Raw DDHQ + Chameleon response bodies, captured behind the web view's Record
// button so a night can be played back through the real pollers, schemas and
// adapters (see sources/recordingHttp.ts). Separate from the session recorder,
// which only keeps adapted observations. One sqlite file per recording.

export type ApiRecording = {
	meta: ApiRecordingMeta;
	responses: ApiResponseRow[];
};

export type ApiRecordingDetail = { sources: ApiSourceCounts[] } & ApiRecordingMeta;

export type ApiRecordingMeta = {
	ddhqQueries: string[];
	name: string;
	startedAt: number;
	stoppedAt: null | number;
};

export type ApiRecordingSummary = {
	file: string;
	name: string;
	responseCount: number;
	startedAt: number;
	stoppedAt: null | number;
};

export type ApiRecordingWriter = {
	append: (row: ApiResponseRow) => void;
	close: (stoppedAt: number, ddhqQueries: string[]) => void;
	count: () => number;
	file: string;
};

export type ApiResponseQuery = {
	beforeSeq?: number;
	errorsOnly?: boolean;
	limit: number;
	source?: ApiSource;
};

export type ApiResponseRow = {
	body: unknown; // parsed JSON; null when the call failed
	error: null | string; // the thrown error message, replayed verbatim
	path: string; // URL with origin stripped — hosts vary (DDHQ next_page_url) or are VPN-only
	source: ApiSource;
	ts: number;
};

export type ApiResponseSummary = {
	bytes: number; // stored JSON size; 0 when the call failed
	error: null | string;
	path: string;
	seq: number;
	source: ApiSource;
	ts: number;
};

export type ApiSource = 'DDHQ' | 'Ross';

export type ApiSourceCounts = { errors: number; responses: number; source: ApiSource };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  name TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  ddhq_queries TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS responses (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  path TEXT NOT NULL,
  error TEXT,
  body TEXT
);
`;

export const apiRecordingDir = (baseDir: string): string => join(baseDir, 'api');

export const apiRecordingFile = (baseDir: string, name: string): string =>
	join(apiRecordingDir(baseDir), `${name}.sqlite`);

export const stripOrigin = (url: string): string => url.replace(/^[a-z]+:\/\/[^/]+/i, '');

export const openApiRecordingWriter = (
	baseDir: string,
	meta: Omit<ApiRecordingMeta, 'stoppedAt'>,
): ApiRecordingWriter => {
	mkdirSync(apiRecordingDir(baseDir), { recursive: true });
	const file = apiRecordingFile(baseDir, meta.name);
	if (existsSync(file)) throw new Error(`API recording already exists: ${file}`);
	const db = new Database(file);
	db.pragma('journal_mode = WAL');
	db.exec(SCHEMA);
	db.prepare(
		'INSERT INTO meta (name, started_at, stopped_at, ddhq_queries) VALUES (?, ?, NULL, ?)',
	).run(meta.name, meta.startedAt, JSON.stringify(meta.ddhqQueries));
	const insert = db.prepare(
		'INSERT INTO responses (ts, source, path, error, body) VALUES (?, ?, ?, ?, ?)',
	);
	let appended = 0;
	return {
		append: (row) => {
			insert.run(
				row.ts,
				row.source,
				row.path,
				row.error,
				row.error === null ? JSON.stringify(row.body) : null,
			);
			appended += 1;
		},
		close: (stoppedAt, ddhqQueries) => {
			db.prepare('UPDATE meta SET stopped_at = ?, ddhq_queries = ?').run(
				stoppedAt,
				JSON.stringify(ddhqQueries),
			);
			// Leave one self-contained file (no -wal/-shm) so a recording can be copied around.
			db.pragma('journal_mode = DELETE');
			db.close();
		},
		count: () => appended,
		file,
	};
};

type MetaRow = {
	ddhq_queries: string;
	name: string;
	started_at: number;
	stopped_at: null | number;
};
type ResponseRow = {
	body: null | string;
	error: null | string;
	path: string;
	source: ApiSource;
	ts: number;
};

const readMeta = (db: Database.Database): ApiRecordingMeta => {
	const row = db.prepare('SELECT * FROM meta LIMIT 1').get() as MetaRow | undefined;
	if (row === undefined) throw new Error('API recording has no meta row');
	return {
		ddhqQueries: JSON.parse(row.ddhq_queries) as string[],
		name: row.name,
		startedAt: row.started_at,
		stoppedAt: row.stopped_at,
	};
};

// A read-only connection also works while the writer still has the file open in WAL
// mode (its -wal/-shm exist then), so a recording in progress can be browsed.
const readOnly = <T>(file: string, read: (db: Database.Database) => T): T => {
	const db = new Database(file, { readonly: true });
	try {
		return read(db);
	} finally {
		db.close();
	}
};

export const loadApiRecording = (file: string): ApiRecording =>
	readOnly(file, (db) => {
		const rows = db
			.prepare('SELECT ts, source, path, error, body FROM responses ORDER BY ts, seq')
			.all() as ResponseRow[];
		return {
			meta: readMeta(db),
			responses: rows.map((row) => ({
				body: row.body === null ? null : (JSON.parse(row.body) as unknown),
				error: row.error,
				path: row.path,
				source: row.source,
				ts: row.ts,
			})),
		};
	});

export const listApiRecordings = (baseDir: string): ApiRecordingSummary[] => {
	const dir = apiRecordingDir(baseDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((entry) => entry.endsWith('.sqlite'))
		.map((entry) => {
			const file = join(dir, entry);
			return readOnly(file, (db) => {
				const meta = readMeta(db);
				const counted = db.prepare('SELECT COUNT(*) AS n FROM responses').get() as { n: number };
				return {
					file,
					name: meta.name,
					responseCount: counted.n,
					startedAt: meta.startedAt,
					stoppedAt: meta.stoppedAt,
				};
			});
		})
		.sort((left, right) => right.startedAt - left.startedAt);
};

export const readApiRecordingMeta = (file: string): ApiRecordingDetail =>
	readOnly(file, (db) => ({
		...readMeta(db),
		sources: db
			.prepare(
				'SELECT source, COUNT(*) AS responses, SUM(error IS NOT NULL) AS errors FROM responses GROUP BY source ORDER BY source',
			)
			.all() as ApiSourceCounts[],
	}));

// Never selects body: a Chameleon body is ~350 KB and a night holds thousands of rows.
// octet_length reads a value's size without loading it.
export const listApiResponses = (file: string, query: ApiResponseQuery): ApiResponseSummary[] =>
	readOnly(
		file,
		(db) =>
			db
				.prepare(
					`SELECT seq, ts, source, path, error, COALESCE(octet_length(body), 0) AS bytes
					FROM responses
					WHERE (@source IS NULL OR source = @source)
						AND (@errorsOnly = 0 OR error IS NOT NULL)
						AND (@beforeSeq IS NULL OR seq < @beforeSeq)
					ORDER BY seq DESC
					LIMIT @limit`,
				)
				.all({
					beforeSeq: query.beforeSeq ?? null,
					errorsOnly: query.errorsOnly === true ? 1 : 0,
					limit: query.limit,
					source: query.source ?? null,
				}) as ApiResponseSummary[],
	);

// The JSON text as stored; null for a failed call or an unknown seq.
export const readApiResponseBody = (file: string, seq: number): null | string =>
	readOnly(
		file,
		(db) =>
			(
				db.prepare('SELECT body FROM responses WHERE seq = ?').get(seq) as
					| { body: null | string }
					| undefined
			)?.body ?? null,
	);

export const resolveApiRecordingFile = (baseDir: string, nameOrPath: string): string =>
	nameOrPath.endsWith('.sqlite') ? nameOrPath : apiRecordingFile(baseDir, basename(nameOrPath));
