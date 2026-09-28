import type { MirrorAnswer } from '../playback/apiPlayback.js';
import type { ApiSource } from '../recording/apiRecording.js';
import type { Night } from './night.js';
import type { Race } from './races.js';
import type { OnAir } from './schedule.js';

import { makeNight, raceAt } from './night.js';
import { chameleonPlaylist, ddhqResponse, nightQueries } from './nightMirror.js';
import { onAirAt } from './schedule.js';

// Runs the simulated air feed's night. Start rolls a new night on a random seed; the
// /air page polls onAir() and renders whatever it says. Once the night's duration is
// up every race holds its final numbers and the ticker and overlays keep cycling.
// Every night this process ran is kept, so airedAt() can say what aired at any past
// moment: the ground truth to score the checker's reads of captured frames against.
// While a night runs, the DDHQ and Chameleon mirrors serve it too (mirror()), so the
// checker's Sim mode sees the same night on all three sources.

export type AirShow = {
	airedAt: (ts: number) => null | OnAir;
	// The running night's answer for a mirror request; undefined when no night runs.
	mirror: (source: ApiSource, path: string) => MirrorAnswer | undefined;
	onAir: () => null | OnAir;
	queries: () => string[] | undefined; // the DDHQ queries covering the running night
	start: (durationMs: number) => AirShowStatus;
	status: () => AirShowStatus | null;
	stop: () => void;
};

export type AirShowConfig = {
	now?: () => number;
	races: readonly Race[];
	randomSeed?: () => number;
};

export type AirShowStatus = {
	called: number;
	durationMs: number;
	elapsedMs: number;
	races: number;
	seed: number;
};

type Run = { night: Night; startedAt: number; stoppedAt: null | number };

export const makeAirShow = (config: AirShowConfig): AirShow => {
	const now = config.now ?? Date.now;
	const randomSeed = config.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 32));
	const runs: Run[] = [];
	const current = (): Run | undefined => runs.find((run) => run.stoppedAt === null);

	const stop = () => {
		const running = current();
		if (running !== undefined) running.stoppedAt = now();
	};

	const airedAt = (ts: number): null | OnAir => {
		const run = runs.find(
			(candidate) =>
				candidate.startedAt <= ts && (candidate.stoppedAt === null || ts < candidate.stoppedAt),
		);
		return run === undefined ? null : onAirAt(run.night, ts - run.startedAt);
	};

	const status = (): AirShowStatus | null => {
		const running = current();
		if (running === undefined) return null;
		const elapsedMs = now() - running.startedAt;
		return {
			called: running.night.plans.filter((plan) => {
				const result = raceAt(plan, elapsedMs);
				return result.left.isWinner || result.right.isWinner;
			}).length,
			durationMs: running.night.durationMs,
			elapsedMs,
			races: running.night.plans.length,
			seed: running.night.seed,
		};
	};

	const mirror = (source: ApiSource, path: string): MirrorAnswer | undefined => {
		const running = current();
		if (running === undefined) return undefined;
		const nowMs = now();
		const elapsedMs = nowMs - running.startedAt;
		const [route = '', query = ''] = path.split('?');
		if (source === 'Ross' && route.startsWith('/chameleon/blade/election/playlist/'))
			return { body: chameleonPlaylist(running.night, elapsedMs, nowMs), kind: 'ok' };
		if (source === 'DDHQ' && route === '/api/v4/races')
			return { body: ddhqResponse(running.night, elapsedMs, nowMs, query), kind: 'ok' };
		return { kind: 'miss', message: `${source} ${path} isn't served by the simulated night` };
	};

	return {
		airedAt,
		mirror,
		onAir: () => airedAt(now()),
		queries: () => {
			const running = current();
			return running === undefined ? undefined : nightQueries(running.night);
		},
		start: (durationMs) => {
			stop();
			runs.push({
				night: makeNight(config.races, randomSeed(), durationMs),
				startedAt: now(),
				stoppedAt: null,
			});
			return status() as AirShowStatus;
		},
		status,
		stop,
	};
};
