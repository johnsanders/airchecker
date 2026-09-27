import type { ApiRecording, ApiResponseRow, ApiSource } from '../replay/apiRecording.js';
import type { HttpJson } from './http.js';

import { stripOrigin } from '../replay/apiRecording.js';
import { errorMessage } from './http.js';

// Record/playback seams over HttpJson, so pollers, schemas and adapters run unchanged
// against a recorded night. Mirrors makeRecordingLlmClient / makeStubLlmClient.

// GETs only: the OAuth token POST is never recorded, so no credentials or tokens land on disk.
export const makeRecordingHttp = (
	inner: HttpJson,
	source: ApiSource,
	record: (row: ApiResponseRow) => void,
	now: () => number = Date.now,
): HttpJson => ({
	getJson: async (url, headers) => {
		try {
			const body = await inner.getJson(url, headers);
			record({ body, error: null, path: stripOrigin(url), source, ts: now() });
			return body;
		} catch (error) {
			record({ body: null, error: errorMessage(error), path: stripOrigin(url), source, ts: now() });
			throw error;
		}
	},
	postJson: inner.postJson,
});

export type PlaybackClock = {
	durationMs: number;
	elapsedMs: () => number; // recording time elapsed, speed-scaled
	ended: () => boolean;
	pause: () => void;
	paused: () => boolean;
	restart: () => void; // back to the first response, keeping paused/running
	resume: () => void;
	speed: number;
	virtualNow: () => number; // position in recording-time (ms epoch of the original night)
};

export const makePlaybackClock = (
	recording: ApiRecording,
	options: { now?: () => number; speed?: number } = {},
): PlaybackClock => {
	const now = options.now ?? Date.now;
	const speed = options.speed ?? 1;
	const firstTs = recording.responses[0]?.ts ?? recording.meta.startedAt;
	const lastTs = recording.responses.at(-1)?.ts ?? firstTs;
	// Elapsed time is banked at each pause; while running, wall time since the anchor adds to it.
	let bankedMs = 0;
	let anchor: null | number = now();
	const elapsedMs = () => bankedMs + (anchor === null ? 0 : (now() - anchor) * speed);
	return {
		durationMs: lastTs - firstTs,
		elapsedMs,
		ended: () => firstTs + elapsedMs() > lastTs,
		pause: () => {
			bankedMs = elapsedMs();
			anchor = null;
		},
		paused: () => anchor === null,
		restart: () => {
			bankedMs = 0;
			if (anchor !== null) anchor = now();
		},
		resume: () => {
			if (anchor === null) anchor = now();
		},
		speed,
		virtualNow: () => firstTs + elapsedMs(),
	};
};

// A recorded poll's later DDHQ pages land a few seconds after page 1. Looking this far
// ahead keeps every page of one poll together instead of mixing in the previous minute's.
const PAGE_LOOKAHEAD_MS = 15_000;

export const makePlaybackHttp = (
	recording: ApiRecording,
	source: ApiSource,
	clock: PlaybackClock,
): HttpJson => {
	const byPath = recording.responses
		.filter((row) => row.source === source)
		.reduce(
			(index, row) => index.set(row.path, [...(index.get(row.path) ?? []), row]),
			new Map<string, ApiResponseRow[]>(),
		);

	return {
		getJson: async (url) => {
			const path = stripOrigin(url);
			const rows = byPath.get(path);
			if (rows === undefined)
				throw new Error(`API playback miss (${source}): ${path} was not recorded`);
			const horizon = clock.virtualNow() + PAGE_LOOKAHEAD_MS;
			const row = rows.filter((candidate) => candidate.ts <= horizon).at(-1);
			// A query added mid-recording has nothing yet; serving its first response early would leak the future.
			if (row === undefined)
				throw new Error(`API playback (${source}): ${path} not recorded yet at this point`);
			if (row.error !== null) throw new Error(row.error);
			return row.body;
		},
		postJson: async () => ({
			access_token: 'api-playback',
			expires_in: 86_400,
			token_type: 'Bearer',
		}),
	};
};
