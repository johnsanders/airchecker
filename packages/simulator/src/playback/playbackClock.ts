import type { ApiRecording } from '../recording/apiRecording.js';

export type PlaybackClock = {
	durationMs: number;
	elapsedMs: () => number;
	ended: () => boolean;
	pause: () => void;
	paused: () => boolean;
	restart: () => void; // back to the first response, keeping paused/running
	resume: () => void;
	seek: (elapsedMs: number) => void; // to any point in the recording, keeping paused/running
	startTs: number; // recording time at elapsed 0
	virtualNow: () => number; // position in recording-time (ms epoch of the original night)
};

// Real time only: the air video that will play alongside runs at 1×, so the API answers do too.
export const makePlaybackClock = (
	recording: ApiRecording,
	now: () => number = Date.now,
): PlaybackClock => {
	const firstTs = recording.responses[0]?.ts ?? recording.meta.startedAt;
	const lastTs = recording.responses.at(-1)?.ts ?? firstTs;
	// Elapsed time is banked at each pause; while running, wall time since the anchor adds to it.
	let bankedMs = 0;
	let anchor: null | number = now();
	const elapsedMs = () => bankedMs + (anchor === null ? 0 : now() - anchor);
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
		seek: (target) => {
			bankedMs = Math.min(Math.max(target, 0), lastTs - firstTs);
			if (anchor !== null) anchor = now();
		},
		startTs: firstTs,
		virtualNow: () => firstTs + elapsedMs(),
	};
};
