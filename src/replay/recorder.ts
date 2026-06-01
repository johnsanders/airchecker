import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RaceIdentityEvent } from '../identity/raceIdentity.js';
import type { RaceObservation } from '../reconcile/reconcile.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  meta TEXT
);
CREATE TABLE IF NOT EXISTS observations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  source TEXT NOT NULL,
  race_key TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_session_seq ON observations(session_id, seq);
CREATE TABLE IF NOT EXISTS frames (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  frame_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  width INTEGER,
  height INTEGER
);
CREATE INDEX IF NOT EXISTS frames_session_seq ON frames(session_id, seq);
CREATE TABLE IF NOT EXISTS llm_calls (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  frame_hash TEXT,
  prompt_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  request TEXT NOT NULL,
  response TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS llm_calls_lookup ON llm_calls(frame_hash, prompt_hash);
CREATE TABLE IF NOT EXISTS identity_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS identity_events_session_seq ON identity_events(session_id, seq);
`;

export type FrameRecordInput = {
	height?: number;
	png: Buffer;
	ts: number;
	width?: number;
};

export type LlmCallInput = {
	frameHash: null | string;
	model: string;
	promptHash: string;
	request: unknown;
	response: unknown;
	ts: number;
};

export type LlmLookupResult = {
	model: string;
	response: unknown;
};

export type Recorder = {
	close: () => void;
	lookupLlm: (frameHash: null | string, promptHash: string) => LlmLookupResult | undefined;
	recordFrame: (input: FrameRecordInput) => string;
	recordIdentityEvent: (event: RaceIdentityEvent) => void;
	recordLlmCall: (input: LlmCallInput) => void;
	recordObservation: (observation: RaceObservation) => void;
	sessionId: string;
};

export type RecorderConfig = {
	baseDir: string;
	meta?: Record<string, unknown>;
	sessionId: string;
};

const sha256Hex = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

const makeRecorder = (config: RecorderConfig): Recorder => {
	if (!existsSync(config.baseDir)) mkdirSync(config.baseDir, { recursive: true });
	const framesDir = join(config.baseDir, config.sessionId, 'frames');
	if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

	const dbPath = join(config.baseDir, `${config.sessionId}.sqlite`);
	const db = new Database(dbPath);
	db.pragma('journal_mode = WAL');
	db.exec(SCHEMA);
	db.prepare('INSERT OR IGNORE INTO sessions (id, started_at, meta) VALUES (?, ?, ?)').run(
		config.sessionId,
		Date.now(),
		JSON.stringify(config.meta ?? {}),
	);

	const insertObservation = db.prepare(
		'INSERT INTO observations (session_id, ts, source, race_key, payload) VALUES (?, ?, ?, ?, ?)',
	);
	const insertFrame = db.prepare(
		'INSERT INTO frames (session_id, ts, frame_hash, path, width, height) VALUES (?, ?, ?, ?, ?, ?)',
	);
	const insertLlm = db.prepare(
		'INSERT INTO llm_calls (session_id, ts, frame_hash, prompt_hash, model, request, response) VALUES (?, ?, ?, ?, ?, ?, ?)',
	);
	const insertIdentityEvent = db.prepare(
		'INSERT INTO identity_events (session_id, ts, event_type, payload) VALUES (?, ?, ?, ?)',
	);
	const selectLlmWithFrame = db.prepare(
		'SELECT model, response FROM llm_calls WHERE frame_hash = ? AND prompt_hash = ? ORDER BY seq DESC LIMIT 1',
	);
	const selectLlmNoFrame = db.prepare(
		'SELECT model, response FROM llm_calls WHERE frame_hash IS NULL AND prompt_hash = ? ORDER BY seq DESC LIMIT 1',
	);
	const endSession = db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?');

	const recordObservation = (observation: RaceObservation): void => {
		insertObservation.run(
			config.sessionId,
			observation.observedAt,
			observation.source,
			observation.raceKey,
			JSON.stringify(observation),
		);
	};

	const recordFrame = (input: FrameRecordInput): string => {
		const hash = sha256Hex(input.png);
		const relativePath = join(config.sessionId, 'frames', `${hash}.png`);
		const absolutePath = join(config.baseDir, relativePath);
		if (!existsSync(absolutePath)) writeFileSync(absolutePath, input.png);
		insertFrame.run(
			config.sessionId,
			input.ts,
			hash,
			relativePath,
			input.width ?? null,
			input.height ?? null,
		);
		return hash;
	};

	const recordLlmCall = (input: LlmCallInput): void => {
		insertLlm.run(
			config.sessionId,
			input.ts,
			input.frameHash,
			input.promptHash,
			input.model,
			JSON.stringify(input.request),
			JSON.stringify(input.response),
		);
	};

	const recordIdentityEvent = (event: RaceIdentityEvent): void => {
		insertIdentityEvent.run(
			config.sessionId,
			Date.now(),
			event.type,
			JSON.stringify(event.payload),
		);
	};

	const lookupLlm = (frameHash: null | string, promptHash: string): LlmLookupResult | undefined => {
		const row =
			frameHash === null
				? (selectLlmNoFrame.get(promptHash) as { model: string; response: string } | undefined)
				: (selectLlmWithFrame.get(frameHash, promptHash) as
						| { model: string; response: string }
						| undefined);
		if (row === undefined) return undefined;
		return { model: row.model, response: JSON.parse(row.response) as unknown };
	};

	const close = (): void => {
		endSession.run(Date.now(), config.sessionId);
		db.close();
	};

	return {
		close,
		lookupLlm,
		recordFrame,
		recordIdentityEvent,
		recordLlmCall,
		recordObservation,
		sessionId: config.sessionId,
	};
};

export { sha256Hex };
export default makeRecorder;
