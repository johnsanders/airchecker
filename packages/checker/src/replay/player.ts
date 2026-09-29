import Database from 'better-sqlite3';
import { join } from 'node:path';

import type { RaceObservation } from '../reconcile/reconcile.js';
import type { AlertEvent } from '../runtime/alertLog.js';
import type { LlmLookupResult } from './recorder.js';

export type FrameRow = {
	frameHash: string;
	height: null | number;
	path: string;
	seq: number;
	ts: number;
	width: null | number;
};

export type Player = {
	close: () => void;
	emitObservationsInto: (handler: (observation: RaceObservation) => void) => void;
	lookupLlm: (frameHash: null | string, promptHash: string) => LlmLookupResult | undefined;
	readAlertEvents: () => AlertEvent[];
	readFrames: () => FrameRow[];
	readObservations: () => RaceObservation[];
	sessionId: string;
};

export type PlayerConfig = {
	baseDir: string;
	sessionId: string;
};

const makePlayer = (config: PlayerConfig): Player => {
	const dbPath = join(config.baseDir, `${config.sessionId}.sqlite`);
	const db = new Database(dbPath, { readonly: true });

	const selectObservations = db.prepare(
		'SELECT payload FROM observations WHERE session_id = ? ORDER BY seq ASC',
	);
	const selectFrames = db.prepare(
		'SELECT seq, ts, frame_hash AS frameHash, path, width, height FROM frames WHERE session_id = ? ORDER BY seq ASC',
	);
	// Sessions recorded before alert history have no table; report none.
	const hasAlertEvents = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'alert_events'")
		.get() as { name: string } | undefined;
	const selectAlertEvents =
		hasAlertEvents === undefined
			? undefined
			: db.prepare('SELECT payload FROM alert_events WHERE session_id = ? ORDER BY seq ASC');
	const selectLlmWithFrame = db.prepare(
		'SELECT model, response FROM llm_calls WHERE frame_hash = ? AND prompt_hash = ? ORDER BY seq DESC LIMIT 1',
	);
	const selectLlmNoFrame = db.prepare(
		'SELECT model, response FROM llm_calls WHERE frame_hash IS NULL AND prompt_hash = ? ORDER BY seq DESC LIMIT 1',
	);

	const readObservations = (): RaceObservation[] =>
		(selectObservations.all(config.sessionId) as { payload: string }[]).map(
			(row) => JSON.parse(row.payload) as RaceObservation,
		);

	const readFrames = (): FrameRow[] => selectFrames.all(config.sessionId) as FrameRow[];

	const lookupLlm = (frameHash: null | string, promptHash: string): LlmLookupResult | undefined => {
		const row =
			frameHash === null
				? (selectLlmNoFrame.get(promptHash) as { model: string; response: string } | undefined)
				: (selectLlmWithFrame.get(frameHash, promptHash) as
						{ model: string; response: string } | undefined);
		if (row === undefined) return undefined;
		return { model: row.model, response: JSON.parse(row.response) as unknown };
	};

	const readAlertEvents = (): AlertEvent[] =>
		selectAlertEvents === undefined
			? []
			: (selectAlertEvents.all(config.sessionId) as { payload: string }[]).map(
					(row) => JSON.parse(row.payload) as AlertEvent,
				);

	const emitObservationsInto = (handler: (observation: RaceObservation) => void): void =>
		readObservations().forEach(handler);

	const close = (): void => {
		db.close();
	};

	return {
		close,
		emitObservationsInto,
		lookupLlm,
		readAlertEvents,
		readFrames,
		readObservations,
		sessionId: config.sessionId,
	};
};

export default makePlayer;
