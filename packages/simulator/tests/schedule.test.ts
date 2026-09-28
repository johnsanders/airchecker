import { describe, expect, it } from 'vitest';

import { makeNight } from '../src/air/night.js';
import { loadRaces } from '../src/air/races.js';
import {
	onAirAt,
	OVERLAY_GAP_MAX_MS,
	OVERLAY_GAP_MIN_MS,
	OVERLAY_MS,
	TICKER_SLOT_MS,
} from '../src/air/schedule.js';

const races = loadRaces('races.json');
const night = makeNight(races, 7, 30 * 60_000);
const STEP_MS = 250;
const seconds = (count: number) =>
	Array.from({ length: (count * 1000) / STEP_MS }, (_, i) => i * STEP_MS);

describe('onAirAt', () => {
	it('advances the ticker only on 8 s boundaries', () =>
		seconds(120)
			.slice(1)
			.forEach((ms) => {
				const changed =
					onAirAt(night, ms).ticker.raceKey !== onAirAt(night, ms - STEP_MS).ticker.raceKey;
				if (changed) expect(ms % TICKER_SLOT_MS).toBe(0);
			}));

	it('shows every race once per ticker pass', () => {
		const pass = races.map((_, slot) => onAirAt(night, slot * TICKER_SLOT_MS).ticker.raceKey);
		expect(new Set(pass).size).toBe(races.length);
	});

	it('holds each overlay 10 s after a 10–20 s gap', () => {
		const timeline = seconds(600).map((ms) => onAirAt(night, ms).overlay !== null);
		const runs = timeline.reduce<{ on: boolean; stepCount: number }[]>((all, on) => {
			const last = all.at(-1);
			if (last?.on === on) last.stepCount += 1;
			else all.push({ on, stepCount: 1 });
			return all;
		}, []);
		// The last run may be cut off by the end of the timeline.
		runs.slice(0, -1).forEach((run) => {
			const durationMs = run.stepCount * STEP_MS;
			if (run.on) {
				expect(durationMs).toBeGreaterThanOrEqual(OVERLAY_MS - STEP_MS);
				expect(durationMs).toBeLessThanOrEqual(OVERLAY_MS + STEP_MS);
			} else {
				expect(durationMs).toBeGreaterThanOrEqual(OVERLAY_GAP_MIN_MS - STEP_MS);
				expect(durationMs).toBeLessThanOrEqual(OVERLAY_GAP_MAX_MS + STEP_MS);
			}
		});
		expect(runs.filter((run) => run.on).length).toBeGreaterThan(15);
	});

	it('shows a race the same on the ticker and an overlay at the same moment', () => {
		const shared = seconds(1800)
			.map((ms) => onAirAt(night, ms))
			.filter((onAir) => onAir.overlay?.raceKey === onAir.ticker.raceKey);
		shared.forEach((onAir) => expect(onAir.overlay?.data).toEqual(onAir.ticker.data));
	});

	it('uses both overlays', () => {
		const kinds = new Set(seconds(600).map((ms) => onAirAt(night, ms).overlay?.kind));
		expect(kinds).toEqual(new Set(['fs', 'l3', undefined]));
	});
});
