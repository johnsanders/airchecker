import type { PlaybackClock } from '../playback/playbackClock.js';
import type { ApiRecording } from '../recording/apiRecording.js';

// The simulated air feed: a 1920×1080 picture that plays in step with an API playback,
// built from the three graphics in the repo root (ticker.html, l3.html,
// fullscreen.html) filled from the recording's data at the clock's virtualNow().
// airchecker captures it the way it captures DirecTV: its debug Chrome holds a tab on
// the feed's URL, and the air source's URL match points at it. Not built yet; the
// playback calls these hooks so the feed has one place to plug in.

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

export const makeAirFeed = (): AirFeed => ({
	pause: () => {},
	resume: () => {},
	start: () => {},
	stop: () => {},
});
