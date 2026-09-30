import type { Aired } from './faults.js';
import type { Night, RacePlan, ResultResolver } from './night.js';

import { airedGraphic } from './faults.js';
import { raceAt } from './night.js';
import { makeRandom, pick, seedFrom, shuffle } from './random.js';

// What's on air at a moment of the night, paced by night.schedule (settings.ts). The
// ticker is always up and moves to the next race every tickerSeconds, through every race
// in a shuffled order that's reshuffled each pass. Over it, after gapSeconds with none,
// an overlay comes up for overlaySeconds, and the cycle repeats: fsCount FS, then l3Count
// L3, each on a race picked at random from those with that graphic.
// The numbers in them trail the night by AIR_LAG_MS, as graphics trail DDHQ — unless
// resolveResult is a source with no notion of lag (liveResultFor), which just ignores it.
// An airing may have something wrong with it (faults.ts); `fault` says what.

export type OnAir = {
	overlay: ({ kind: OverlayKind; raceKey: string } & Aired) | null;
	ticker: { raceKey: string } & Aired;
};

export type Overlay = {
	hideAtMs: number;
	index: number;
	kind: OverlayKind;
	plan: RacePlan;
	showAtMs: number;
};

export type OverlayKind = 'fs' | 'l3';

const tickerSlot = (night: Night, elapsedMs: number): number =>
	Math.floor(elapsedMs / (night.schedule.tickerSeconds * 1000));

const tickerPlan = (night: Night, elapsedMs: number): RacePlan => {
	const slot = tickerSlot(night, elapsedMs);
	const pass = Math.floor(slot / night.plans.length);
	const order = shuffle(makeRandom(seedFrom(night.seed, 'ticker', pass)), night.plans);
	return order[slot % night.plans.length] as RacePlan;
};

const cycleMs = (night: Night): number =>
	(night.schedule.gapSeconds + night.schedule.overlaySeconds) * 1000;

// Cycle `index` runs from index × cycleMs: its gap, then its overlay.
const overlayNumber = (night: Night, index: number): Overlay | undefined => {
	const mix = night.schedule.fsCount + night.schedule.l3Count;
	if (mix === 0) return undefined;
	const kind: OverlayKind = index % mix < night.schedule.fsCount ? 'fs' : 'l3';
	const showAtMs = index * cycleMs(night) + night.schedule.gapSeconds * 1000;
	return {
		hideAtMs: showAtMs + night.schedule.overlaySeconds * 1000,
		index,
		kind,
		plan: pick(
			makeRandom(seedFrom(night.seed, 'overlay', index)),
			night.plans.filter((plan) => plan.race.graphics.includes(kind)),
		) as RacePlan,
		showAtMs,
	};
};

// The overlay on air at a moment, or the one coming up in the gap before it.
const overlayCycle = (night: Night, elapsedMs: number): Overlay | undefined =>
	overlayNumber(night, Math.floor(elapsedMs / cycleMs(night)));

export const overlayAt = (night: Night, elapsedMs: number): Overlay | undefined => {
	const cycle = overlayCycle(night, elapsedMs);
	return cycle === undefined || elapsedMs < cycle.showAtMs ? undefined : cycle;
};

export const nextOverlay = (night: Night, elapsedMs: number): Overlay | undefined => {
	const cycle = overlayCycle(night, elapsedMs);
	return cycle === undefined || elapsedMs < cycle.showAtMs
		? cycle
		: overlayNumber(night, cycle.index + 1);
};

export const onAirAt = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver = raceAt,
): OnAir => {
	const ticker = tickerPlan(night, elapsedMs);
	const overlay = overlayAt(night, elapsedMs);
	return {
		overlay:
			overlay === undefined
				? null
				: {
						...airedGraphic(
							night,
							overlay.plan,
							`overlay ${overlay.index}`,
							elapsedMs,
							resolveResult,
						),
						kind: overlay.kind,
						raceKey: overlay.plan.race.key,
					},
		ticker: {
			...airedGraphic(
				night,
				ticker,
				`ticker ${tickerSlot(night, elapsedMs)}`,
				elapsedMs,
				resolveResult,
			),
			raceKey: ticker.race.key,
		},
	};
};
