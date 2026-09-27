import type { ApiSource } from '../replay/apiRecording.js';
import type { HttpJson } from '../sources/http.js';
import type { PlaybackClock } from '../sources/recordingHttp.js';

import { listApiRecordings, loadApiRecording } from '../replay/apiRecording.js';
import { makePlaybackClock, makePlaybackHttp } from '../sources/recordingHttp.js';

// API playback, started and steered from the web view: which recording answers DDHQ and
// Chameleon, and where its clock stands. It only swaps the answers; clearing live state
// and re-pacing the pollers is the caller's, through onRun.

export type ApiPlayback = {
	http: (source: ApiSource) => HttpJson | undefined; // undefined when live
	pause: () => void;
	queries: () => string[] | undefined; // the recording's DDHQ query list; undefined when live
	restart: () => void;
	resume: () => void;
	// Throws for a name that isn't in the recordings listing.
	start: (name: string, speed: number) => void;
	status: () => ApiPlaybackStatus | undefined;
	stop: () => void;
};

export type ApiPlaybackConfig = {
	baseDir: string;
	now?: () => number;
	// A fresh run begins (start, restart) or playback ends (speed undefined).
	onRun: (speed: number | undefined) => void;
};

export type ApiPlaybackStatus = {
	durationMs: number;
	elapsedMs: number;
	ended: boolean;
	name: string;
	paused: boolean;
	speed: number;
};

type Playing = {
	clock: PlaybackClock;
	http: Record<ApiSource, HttpJson>;
	name: string;
	queries: string[];
};

export const makeApiPlayback = (config: ApiPlaybackConfig): ApiPlayback => {
	let playing: Playing | undefined;

	return {
		http: (source) => playing?.http[source],
		pause: () => playing?.clock.pause(),
		queries: () => playing?.queries,
		restart: () => {
			if (playing === undefined) return;
			playing.clock.restart();
			config.onRun(playing.clock.speed);
		},
		resume: () => playing?.clock.resume(),
		start: (name, speed) => {
			// Resolved only through the listing, so a name can never reach outside the directory.
			const file = listApiRecordings(config.baseDir).find((summary) => summary.name === name)?.file;
			if (file === undefined) throw new Error(`no API recording named ${name}`);
			const recording = loadApiRecording(file);
			const clock = makePlaybackClock(recording, {
				speed,
				...(config.now === undefined ? {} : { now: config.now }),
			});
			playing = {
				clock,
				http: {
					DDHQ: makePlaybackHttp(recording, 'DDHQ', clock),
					Ross: makePlaybackHttp(recording, 'Ross', clock),
				},
				name: recording.meta.name,
				queries: recording.meta.ddhqQueries,
			};
			config.onRun(speed);
		},
		status: () =>
			playing === undefined
				? undefined
				: {
						durationMs: playing.clock.durationMs,
						elapsedMs: Math.min(playing.clock.elapsedMs(), playing.clock.durationMs),
						ended: playing.clock.ended(),
						name: playing.name,
						paused: playing.clock.paused(),
						speed: playing.clock.speed,
					},
		stop: () => {
			if (playing === undefined) return;
			playing = undefined;
			config.onRun(undefined);
		},
	};
};
