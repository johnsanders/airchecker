import { randomUUID } from 'node:crypto';

import type { Recorder } from '../replay/recorder.js';

import makeRecorder, { sha256Hex } from '../replay/recorder.js';

// Monitoring on/off from the web view. Each start opens a fresh session recording and
// each stop closes it (ended_at set), so a rehearsal and the broadcast night are
// separate sessions without restarting the process.

export type LiveSession = {
	currentId: () => string | undefined;
	recorder: SessionRecorder;
	start: () => SessionStatus;
	status: () => SessionStatus;
	stop: () => SessionStatus;
};

export type LiveSessionConfig = {
	baseDir: string;
	onStart: () => void; // start the pollers + air scheduler
	onStop: () => void; // stop them
};

// What the sources write through. It outlives any one session: the LLM client, air
// source and identity resolver hold it for the life of the process, and it forwards to
// whichever session is open. A poll or capture still in flight when monitoring stops
// lands here with no session open and is dropped.
export type SessionRecorder = Pick<
	Recorder,
	'recordAlertEvent' | 'recordFrame' | 'recordIdentityEvent' | 'recordLlmCall' | 'recordObservation'
>;

export type SessionStatus = { id: null | string; running: boolean; startedAt: null | number };

const newSessionId = (): string =>
	`live-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;

export const makeLiveSession = (config: LiveSessionConfig): LiveSession => {
	let current: { recorder: Recorder; startedAt: number } | undefined;

	const status = (): SessionStatus => ({
		id: current?.recorder.sessionId ?? null,
		running: current !== undefined,
		startedAt: current?.startedAt ?? null,
	});

	return {
		currentId: () => current?.recorder.sessionId,
		recorder: {
			recordAlertEvent: (event) => current?.recorder.recordAlertEvent(event),
			// The hash is content-derived, so it's the same whether or not it was written.
			recordFrame: (input) => current?.recorder.recordFrame(input) ?? sha256Hex(input.png),
			recordIdentityEvent: (event) => current?.recorder.recordIdentityEvent(event),
			recordLlmCall: (input) => current?.recorder.recordLlmCall(input),
			recordObservation: (observation) => current?.recorder.recordObservation(observation),
		},
		start: () => {
			if (current !== undefined) return status();
			current = {
				recorder: makeRecorder({ baseDir: config.baseDir, sessionId: newSessionId() }),
				startedAt: Date.now(),
			};
			config.onStart();
			return status();
		},
		status,
		stop: () => {
			if (current === undefined) return status();
			config.onStop();
			current.recorder.close();
			current = undefined;
			return status();
		},
	};
};
