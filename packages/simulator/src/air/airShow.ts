import type { Night } from './night.js';
import type { Race } from './races.js';
import type { OnAir } from './schedule.js';

import { makeNight, raceAt } from './night.js';
import { onAirAt } from './schedule.js';

// Runs the simulated air feed's night. Start rolls a new night on a random seed; the
// /air page polls onAir() and renders whatever it says. Once the night's duration is
// up every race holds its final numbers and the ticker and overlays keep cycling.
// Every night this process ran is kept, so airedAt() can say what aired at any past
// moment: the ground truth to score the checker's reads of captured frames against.

export type AirShow = {
	airedAt: (ts: number) => null | OnAir;
	onAir: () => null | OnAir;
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

	return {
		airedAt,
		onAir: () => airedAt(now()),
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
