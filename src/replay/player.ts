import Database from 'better-sqlite3';
import { join } from 'node:path';

import type { RaceObservation } from '../reconcile/reconcile.js';

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

	const readObservations = (): RaceObservation[] =>
		(selectObservations.all(config.sessionId) as { payload: string }[]).map(
			(row) => JSON.parse(row.payload) as RaceObservation,
		);

	const readFrames = (): FrameRow[] => selectFrames.all(config.sessionId) as FrameRow[];

	const emitObservationsInto = (handler: (observation: RaceObservation) => void): void =>
		readObservations().forEach(handler);

	const close = (): void => {
		db.close();
	};

	return {
		close,
		emitObservationsInto,
		readFrames,
		readObservations,
		sessionId: config.sessionId,
	};
};

export default makePlayer;
