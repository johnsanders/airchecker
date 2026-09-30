import type { MirrorAnswer } from '../playback/apiPlayback.js';
import type { ApiSource } from '../recording/apiRecording.js';
import type { AirSchedule, AirSource } from '../settings.js';
import type { AirFeed, PlaybackHandle } from './airFeed.js';
import type { LiveResultsSource } from './liveResults.js';
import type { Night, RacePlan, RaceResult, ResultResolver } from './night.js';
import type { Race } from './races.js';
import type { OnAir, Overlay, OverlayKind } from './schedule.js';

import { DEFAULT_AIR_SCHEDULE } from '../settings.js';
import { liveResultFor } from './liveResults.js';
import { AIR_LAG_MS, CHAMELEON_LAG_MS, makeNight, raceAt } from './night.js';
import { chameleonPlaylist, ddhqResponse, nightQueries } from './nightMirror.js';
import { makeRecordedResults } from './recordedResults.js';
import { nextOverlay, onAirAt, overlayAt } from './schedule.js';

// Runs the simulated air feed's night. Start rolls a new night on a random seed; the
// /air page polls onAir() and renders whatever it says. Once the night's duration is
// up every race holds its final numbers and the ticker and overlays keep cycling.
// Every night this process ran is kept, so airedAt() can say what aired at any past
// moment, and what if anything was wrong with it (faults.ts): the ground truth to score
// the checker's reads of captured frames, and what it caught, against.
// While a night runs, the DDHQ and Chameleon mirrors serve it too (mirror()), so the
// checker's Sim mode sees the same night on all three sources.
//
// getAirSource picks each run's numbers: invented (raceAt) or, with liveResults wired
// up, DDHQ's integration host (liveResultFor) — chosen once, at start(), so switching
// the setting mid-run has no effect until the next Start. liveResults itself only runs
// while a live run is on air, started and stopped on the transition in and out of one.
//
// feed is the third way on air: an API recording playing back (apiPlayback.ts calls it on
// every start, pause, resume, restart and stop). Its races are the take-list races the
// recording's Chameleon playlists carry, their numbers the recorded ones, and the mirrors
// are left to the playback. Each pause or resume starts a new run, so a run's recording
// time is always its start plus wall time elapsed (or frozen, while paused).

export type AirShow = {
	airedAt: (ts: number) => null | OnAir;
	feed: AirFeed;
	liveResultErrors: () => string[];
	// The running night's answer for a mirror request; undefined when no night runs.
	mirror: (source: ApiSource, path: string) => MirrorAnswer | undefined;
	onAir: () => null | OnAir;
	queries: () => string[] | undefined; // the DDHQ queries covering the running night
	// faultRate: the share of airings, 0 to 1, that put something wrong on air. Default 0.
	start: (durationMs: number, faultRate?: number) => AirShowStatus;
	status: () => AirShowStatus | null;
	stop: () => void;
};

export type AirShowConfig = {
	getAirSource?: () => AirSource; // defaults to 'invented' when omitted
	getSchedule?: () => AirSchedule; // read as each run starts; defaults to DEFAULT_AIR_SCHEDULE
	liveResults?: LiveResultsSource;
	now?: () => number;
	races: readonly Race[];
	randomSeed?: () => number;
};

export type AirShowStatus = {
	called: number;
	durationMs: number;
	elapsedMs: number;
	faultRate: number;
	next: null | OverlayStatus; // the next overlay to come up; null when the mix has none
	overlay: null | OverlayStatus; // the overlay up now
	races: number;
	recording: null | string; // the API recording on air, if that's what's on air
	schedule: AirSchedule;
	seed: number;
	ticker: string; // the race on the ticker now
};

// atMs: when it comes up (next) or goes down (overlay), in epoch ms.
export type OverlayStatus = { atMs: number; kind: OverlayKind; race: string };

const raceLabel = (plan: RacePlan): string =>
	`${plan.race.state}${plan.race.district === '' ? '' : `-${plan.race.district}`} ${plan.race.office}`;

type Playing = {
	handle: PlaybackHandle;
	night: Night;
	resolveAt: (plan: RacePlan, ts: number) => RaceResult;
};

type Run = {
	live: boolean;
	night: Night;
	recording: null | string;
	resolveResult: ResultResolver;
	startedAt: number;
	stoppedAt: null | number;
};

export const makeAirShow = (config: AirShowConfig): AirShow => {
	const now = config.now ?? Date.now;
	const randomSeed = config.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 32));
	const runs: Run[] = [];
	const current = (): Run | undefined => runs.find((run) => run.stoppedAt === null);
	let playing: Playing | undefined;
	const schedule = (): AirSchedule => config.getSchedule?.() ?? DEFAULT_AIR_SCHEDULE;

	const endCurrentRun = () => {
		const running = current();
		if (running !== undefined) running.stoppedAt = now();
	};

	const airedAt = (ts: number): null | OnAir => {
		const run = runs.find(
			(candidate) =>
				candidate.startedAt <= ts && (candidate.stoppedAt === null || ts < candidate.stoppedAt),
		);
		return run === undefined ? null : onAirAt(run.night, ts - run.startedAt, run.resolveResult);
	};

	const status = (): AirShowStatus | null => {
		const running = current();
		if (running === undefined) return null;
		const elapsedMs = now() - running.startedAt;
		const overlayStatus = (overlay: Overlay | undefined, atMs: number): null | OverlayStatus =>
			overlay === undefined
				? null
				: { atMs: running.startedAt + atMs, kind: overlay.kind, race: raceLabel(overlay.plan) };
		const up = overlayAt(running.night, elapsedMs);
		const next = nextOverlay(running.night, elapsedMs);
		const onAir = onAirAt(running.night, elapsedMs, running.resolveResult);
		return {
			called: running.night.plans.filter((plan) => {
				const result = running.resolveResult(plan, elapsedMs - AIR_LAG_MS); // called on air
				return result.left.isWinner || result.right.isWinner;
			}).length,
			durationMs: running.night.durationMs,
			elapsedMs:
				running.recording === null
					? elapsedMs
					: Math.min(playing?.handle.clock.elapsedMs() ?? 0, running.night.durationMs),
			faultRate: running.night.faultRate,
			next: overlayStatus(next, next?.showAtMs ?? 0),
			overlay: overlayStatus(up, up?.hideAtMs ?? 0),
			races: running.night.plans.length,
			recording: running.recording,
			schedule: running.night.schedule,
			seed: running.night.seed,
			ticker: raceLabel(
				running.night.plans.find((plan) => plan.race.key === onAir.ticker.raceKey) as RacePlan,
			),
		};
	};

	const mirror = (source: ApiSource, path: string): MirrorAnswer | undefined => {
		const running = current();
		if (running === undefined || running.recording !== null) return undefined;
		const nowMs = now();
		const elapsedMs = nowMs - running.startedAt;
		const [route = '', query = ''] = path.split('?');
		if (source === 'Ross' && route.startsWith('/chameleon/blade/election/playlist/'))
			return {
				body: chameleonPlaylist(running.night, elapsedMs, nowMs, running.resolveResult),
				kind: 'ok',
			};
		if (source === 'DDHQ' && route === '/api/v4/races')
			return {
				body: ddhqResponse(running.night, elapsedMs, nowMs, query, running.resolveResult),
				kind: 'ok',
			};
		return { kind: 'miss', message: `${source} ${path} isn't served by the simulated night` };
	};

	// The graphics trail Chameleon (the recording's playlists) by what the simulated
	// night's do: AIR_LAG_MS − CHAMELEON_LAG_MS. onAirAt passes a run's elapsed time less
	// AIR_LAG_MS, so that's added back to find the run's own elapsed time.
	const airRecording = (): void => {
		endCurrentRun();
		if (playing === undefined || playing.night.plans.length === 0) return;
		const clock = playing.handle.clock;
		const resolveAt = playing.resolveAt;
		const recordingStart = clock.virtualNow();
		const rate = clock.paused() ? 0 : 1;
		runs.push({
			live: false,
			night: playing.night,
			recording: playing.handle.recording.meta.name,
			resolveResult: (plan, elapsedMs) =>
				resolveAt(
					plan,
					recordingStart + rate * (elapsedMs + AIR_LAG_MS) - (AIR_LAG_MS - CHAMELEON_LAG_MS),
				),
			startedAt: now(),
			stoppedAt: null,
		});
	};

	const feed: AirFeed = {
		pause: airRecording,
		resume: airRecording,
		seek: airRecording,
		start: (handle) => {
			const wasLive = current()?.live ?? false;
			const results = makeRecordedResults(handle.recording);
			playing = {
				handle,
				night: makeNight(
					config.races.filter((race) => results.raceIds.has(race.ddhq.raceId)),
					randomSeed(),
					handle.clock.durationMs,
					0,
					schedule(),
				),
				resolveAt: results.resultAt,
			};
			airRecording();
			if (wasLive) config.liveResults?.stop();
		},
		stop: () => {
			playing = undefined;
			if (current()?.recording !== null) endCurrentRun();
		},
	};

	return {
		airedAt,
		feed,
		liveResultErrors: () => config.liveResults?.errors() ?? [],
		mirror,
		onAir: () => airedAt(now()),
		queries: () => {
			const running = current();
			return running === undefined || running.recording !== null
				? undefined
				: nightQueries(running.night);
		},
		start: (durationMs, faultRate = 0) => {
			const wasLive = current()?.live ?? false;
			endCurrentRun();
			const live =
				(config.getAirSource?.() ?? 'invented') === 'ddhqIntegration' &&
				config.liveResults !== undefined;
			runs.push({
				live,
				night: makeNight(config.races, randomSeed(), durationMs, faultRate, schedule()),
				recording: null,
				resolveResult: live
					? (plan) => liveResultFor(plan, config.liveResults?.getResult(plan.race.ddhq.raceId))
					: raceAt,
				startedAt: now(),
				stoppedAt: null,
			});
			if (live !== wasLive) (live ? config.liveResults?.start : config.liveResults?.stop)?.();
			return status() as AirShowStatus;
		},
		status,
		// A recording on air ends with its playback (feed.stop), not here.
		stop: () => {
			const running = current();
			if (running === undefined || running.recording !== null) return;
			endCurrentRun();
			if (running.live) config.liveResults?.stop();
		},
	};
};
