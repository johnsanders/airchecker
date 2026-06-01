import Database from 'better-sqlite3';
import { join } from 'node:path';

import type { RaceIdentityEvent } from '../identity/raceIdentity.js';
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
	readIdentityEvents: () => RaceIdentityEvent[];
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
	const hasIdentityEvents = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'identity_events'")
		.get() as { name: string } | undefined;
	const selectIdentityEvents =
		hasIdentityEvents === undefined
			? undefined
			: db.prepare(
					'SELECT event_type AS eventType, payload FROM identity_events WHERE session_id = ? ORDER BY seq ASC',
				);

	const readObservations = (): RaceObservation[] =>
		(selectObservations.all(config.sessionId) as { payload: string }[]).map(
			(row) => JSON.parse(row.payload) as RaceObservation,
		);

	const readFrames = (): FrameRow[] => selectFrames.all(config.sessionId) as FrameRow[];

	const readIdentityEvents = (): RaceIdentityEvent[] =>
		selectIdentityEvents === undefined
			? []
			: (
					selectIdentityEvents.all(config.sessionId) as {
						eventType: RaceIdentityEvent['type'];
						payload: string;
					}[]
				).map(
					(row) =>
						({
							payload: JSON.parse(row.payload) as RaceIdentityEvent['payload'],
							type: row.eventType,
						}) as RaceIdentityEvent,
				);

	const emitObservationsInto = (handler: (observation: RaceObservation) => void): void =>
		readObservations().forEach(handler);

	const close = (): void => {
		db.close();
	};

	return {
		close,
		emitObservationsInto,
		readFrames,
		readIdentityEvents,
		readObservations,
		sessionId: config.sessionId,
	};
};

export default makePlayer;
