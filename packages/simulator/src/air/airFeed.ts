import type { PlaybackClock } from '../playback/playbackClock.js';
import type { ApiRecording } from '../recording/apiRecording.js';

// Playback hooks for an air feed driven by the recording at the clock's virtualNow(),
// called on every playback start/pause/resume/restart/stop. airShow.ts's feed is the one:
// a recording playing back is on the simulated air.

export type AirFeed = {
	pause: () => void;
	resume: () => void;
	start: (playback: PlaybackHandle) => void; // also on restart, with the clock back at zero
	stop: () => void;
};

export type PlaybackHandle = {
	clock: PlaybackClock;
	recording: ApiRecording;
};
