import type { AirFeed } from '../air/airFeed.js';
import type { ApiRecording, ApiSource, RecordedResponse } from '../recording/apiRecording.js';
import type { PlaybackClock } from './playbackClock.js';

import { listApiRecordings, loadApiRecording } from '../recording/apiRecording.js';
import { makePlaybackClock } from './playbackClock.js';

// Plays one API recording back: the mirror endpoints answer each request with the
// response recorded for that exact path (origin stripped) most recently at or before
// the playback clock. Pause, resume, restart and stop move the clock and the air feed.

export type ApiPlayback = {
	answer: (source: ApiSource, path: string) => MirrorAnswer;
	pause: () => void;
	restart: () => void;
	resume: () => void;
	// Throws for a name that isn't in the recordings listing.
	start: (name: string) => void;
	status: () => ApiPlaybackStatus | undefined;
	stop: () => void;
};

export type ApiPlaybackConfig = {
	airFeed: AirFeed;
	baseDir: string;
	now?: () => number;
};

export type ApiPlaybackStatus = {
	ddhqQueries: string[];
	durationMs: number;
	elapsedMs: number;
	ended: boolean;
	name: string;
	paused: boolean;
};

export type MirrorAnswer =
	| { body: unknown; kind: 'ok' }
	| { kind: 'error'; message: string } // recorded as a failure; replayed as one
	| { kind: 'idle' } // nothing playing
	| { kind: 'miss'; message: string };

type Playing = {
	byPath: Map<string, RecordedResponse[]>;
	clock: PlaybackClock;
	recording: ApiRecording;
};

// A recorded poll's later DDHQ pages land a few seconds after page 1. Looking this far
// ahead keeps every page of one poll together instead of mixing in the previous minute's.
const PAGE_LOOKAHEAD_MS = 15_000;

const pathKey = (source: ApiSource, path: string): string => `${source} ${path}`;

export const makeApiPlayback = (config: ApiPlaybackConfig): ApiPlayback => {
	let playing: Playing | undefined;

	return {
		answer: (source, path) => {
			if (playing === undefined) return { kind: 'idle' };
			const rows = playing.byPath.get(pathKey(source, path));
			if (rows === undefined)
				return { kind: 'miss', message: `${source} ${path} was not recorded` };
			const horizon = playing.clock.virtualNow() + PAGE_LOOKAHEAD_MS;
			const row = rows.filter((candidate) => candidate.ts <= horizon).at(-1);
			// A query added mid-recording has nothing yet; serving its first response early would leak the future.
			if (row === undefined)
				return { kind: 'miss', message: `${source} ${path} not recorded yet at this point` };
			return row.error === null
				? { body: row.body(), kind: 'ok' }
				: { kind: 'error', message: row.error };
		},
		pause: () => {
			if (playing === undefined) return;
			playing.clock.pause();
			config.airFeed.pause();
		},
		restart: () => {
			if (playing === undefined) return;
			playing.clock.restart();
			config.airFeed.start({ clock: playing.clock, recording: playing.recording });
		},
		resume: () => {
			if (playing === undefined) return;
			playing.clock.resume();
			config.airFeed.resume();
		},
		start: (name) => {
			// Resolved only through the listing, so a name can never reach outside the directory.
			const file = listApiRecordings(config.baseDir).find((summary) => summary.name === name)?.file;
			if (file === undefined) throw new Error(`no API recording named ${name}`);
			const recording = loadApiRecording(file);
			if (playing !== undefined) config.airFeed.stop();
			playing = {
				byPath: recording.responses.reduce(
					(index, row) =>
						index.set(pathKey(row.source, row.path), [
							...(index.get(pathKey(row.source, row.path)) ?? []),
							row,
						]),
					new Map<string, RecordedResponse[]>(),
				),
				clock: makePlaybackClock(recording, config.now),
				recording,
			};
			config.airFeed.start({ clock: playing.clock, recording });
		},
		status: () =>
			playing === undefined
				? undefined
				: {
						ddhqQueries: playing.recording.meta.ddhqQueries,
						durationMs: playing.clock.durationMs,
						elapsedMs: Math.min(playing.clock.elapsedMs(), playing.clock.durationMs),
						ended: playing.clock.ended(),
						name: playing.recording.meta.name,
						paused: playing.clock.paused(),
					},
		stop: () => {
			if (playing === undefined) return;
			playing = undefined;
			config.airFeed.stop();
		},
	};
};
