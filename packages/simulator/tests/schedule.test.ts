import { describe, expect, it } from 'vitest';

import type { ResultResolver } from '../src/air/night.js';
import type { AirSchedule } from '../src/settings.js';

import { AIR_LAG_MS, makeNight, raceAt } from '../src/air/night.js';
import { loadRaces } from '../src/air/races.js';
import { nextOverlay, onAirAt, overlayAt } from '../src/air/schedule.js';
import { DEFAULT_AIR_SCHEDULE } from '../src/settings.js';

const races = loadRaces('races.json');
const night = makeNight(races, 7, 30 * 60_000);
const paced = (schedule: Partial<AirSchedule>) =>
	makeNight(races, 7, 30 * 60_000, 0, { ...DEFAULT_AIR_SCHEDULE, ...schedule });
// Every race in with its final numbers, so pacing is tested with every race eligible.
const allIn: ResultResolver = (plan) => raceAt(plan, Number.MAX_SAFE_INTEGER);
const STEP_MS = 250;
const seconds = (count: number) =>
	Array.from({ length: (count * 1000) / STEP_MS }, (_, i) => i * STEP_MS);

// The overlay kinds in the order they come up over the first `count` seconds.
const overlayKinds = (paced: ReturnType<typeof makeNight>, count: number) =>
	seconds(count)
		.map((ms) => overlayAt(paced, ms, allIn))
		.filter((overlay, i, all) => overlay !== undefined && overlay.index !== all[i - 1]?.index)
		.map((overlay) => overlay?.kind);

describe('onAirAt', () => {
	it('advances the ticker only on its boundaries', () =>
		[night, paced({ tickerSeconds: 5 })].forEach((each) =>
			seconds(120)
				.slice(1)
				.forEach((ms) => {
					const changed =
						onAirAt(each, ms).ticker?.raceKey !== onAirAt(each, ms - STEP_MS).ticker?.raceKey;
					if (changed) expect(ms % (each.schedule.tickerSeconds * 1000)).toBe(0);
				}),
		));

	it('shows every race once per ticker pass', () => {
		const pass = races.map(
			(_, slot) =>
				onAirAt(night, slot * DEFAULT_AIR_SCHEDULE.tickerSeconds * 1000, allIn).ticker?.raceKey,
		);
		expect(new Set(pass).size).toBe(races.length);
	});

	it('holds each overlay for overlaySeconds after a gap of gapSeconds', () => {
		const timeline = seconds(300).map(
			(ms) => onAirAt(paced({ gapSeconds: 7, overlaySeconds: 4 }), ms, allIn).overlay !== null,
		);
		const runs = timeline.reduce<{ on: boolean; stepCount: number }[]>((all, on) => {
			const last = all.at(-1);
			if (last?.on === on) last.stepCount += 1;
			else all.push({ on, stepCount: 1 });
			return all;
		}, []);
		expect(runs[0]).toEqual({ on: false, stepCount: 7000 / STEP_MS });
		// The last run may be cut off by the end of the timeline.
		runs.slice(0, -1).forEach((run) => expect(run.stepCount * STEP_MS).toBe(run.on ? 4000 : 7000));
	});

	it('runs fsCount FS then l3Count L3, over and over', () => {
		expect(overlayKinds(paced({ fsCount: 2, gapSeconds: 1, l3Count: 3 }), 11 * 10)).toEqual([
			'fs',
			'fs',
			'l3',
			'l3',
			'l3',
			'fs',
			'fs',
			'l3',
			'l3',
			'l3',
		]);
		expect(new Set(overlayKinds(paced({ fsCount: 0, l3Count: 1 }), 600))).toEqual(new Set(['l3']));
	});

	it('shows the ticker alone when both counts are 0', () => {
		const tickerOnly = paced({ fsCount: 0, l3Count: 0 });
		expect(seconds(120).every((ms) => onAirAt(tickerOnly, ms, allIn).overlay === null)).toBe(true);
		expect(nextOverlay(tickerOnly, 0, allIn)).toBeUndefined();
	});

	it('shows a race the same on the ticker and an overlay at the same moment', () => {
		const shared = seconds(1800)
			.map((ms) => onAirAt(night, ms))
			.filter((onAir) => onAir.ticker !== null && onAir.overlay?.raceKey === onAir.ticker.raceKey);
		shared.forEach((onAir) => expect(onAir.overlay?.data).toEqual(onAir.ticker?.data));
	});

	it('only airs races with votes on air', () =>
		seconds(1800).forEach((ms) => {
			const onAir = onAirAt(night, ms);
			[onAir.ticker, onAir.overlay].forEach((shown) => {
				if (shown === null) return;
				const plan = night.plans.find((candidate) => candidate.race.key === shown.raceKey)!;
				expect(raceAt(plan, ms - AIR_LAG_MS).totalVotes).toBeGreaterThan(0);
			});
		}));

	it('keeps the ticker down, counting down to it, until the first race has votes', () => {
		const opening = onAirAt(night, 0);
		expect(opening).toMatchObject({ overlay: null, ticker: null });
		const upAtMs = opening.waiting?.firstResultsInMs ?? 0;
		expect(upAtMs).toBeGreaterThan(0);
		expect(onAirAt(night, upAtMs / 2).waiting?.firstResultsInMs).toBe(upAtMs / 2);
		expect(onAirAt(night, upAtMs - 1).ticker).toBeNull();
		expect(onAirAt(night, upAtMs)).toMatchObject({ ticker: expect.anything(), waiting: null });
	});

	it("can't count down when the numbers don't say ahead", () =>
		expect(onAirAt(night, 60_000, (plan) => raceAt(plan, 0)).waiting).toEqual({
			firstResultsInMs: null,
		}));
});

describe('nextOverlay', () => {
	it('names the overlay that comes up next, and when', () =>
		seconds(300).forEach((ms) => {
			const next = nextOverlay(night, ms, allIn);
			expect(next?.showAtMs).toBeGreaterThan(ms);
			expect(overlayAt(night, (next?.showAtMs ?? 0) - 1, allIn)?.index).not.toBe(next?.index);
			expect(onAirAt(night, next?.showAtMs ?? 0, allIn).overlay).toMatchObject({
				kind: next?.kind,
				raceKey: next?.plan.race.key,
			});
		}));
});
