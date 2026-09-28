import type { Night } from './night.js';
import type { Race } from './races.js';
import type { OnAir } from './schedule.js';

import { makeNight, raceAt } from './night.js';
import { onAirAt } from './schedule.js';

// Runs the simulated air feed's night. Start rolls a new night on a random seed; the
// /air page polls onAir() and renders whatever it says. Once the night's duration is
// up every race holds its final numbers and the ticker and overlays keep cycling.

export type AirShow = {
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

export const makeAirShow = (config: AirShowConfig): AirShow => {
	const now = config.now ?? Date.now;
	const randomSeed = config.randomSeed ?? (() => Math.floor(Math.random() * 2 ** 32));
	let running: { night: Night; startedAt: number } | undefined;

	const status = (): AirShowStatus | null => {
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
		onAir: () => (running === undefined ? null : onAirAt(running.night, now() - running.startedAt)),
		start: (durationMs) => {
			running = { night: makeNight(config.races, randomSeed(), durationMs), startedAt: now() };
			return status() as AirShowStatus;
		},
		status,
		stop: () => {
			running = undefined;
		},
	};
};
