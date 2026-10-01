import type { Aired } from './faults.js';
import type { Night, RacePlan, ResultResolver } from './night.js';

import { airedGraphic } from './faults.js';
import { AIR_LAG_MS, raceAt } from './night.js';
import { makeRandom, pick, seedFrom, shuffle } from './random.js';

// What's on air at a moment of the night, paced by night.schedule (settings.ts). The
// ticker moves to the next race every tickerSeconds, through every race in a shuffled
// order that's reshuffled each pass. Over it, after gapSeconds with none, an overlay comes
// up for overlaySeconds, and the cycle repeats: fsCount FS, then l3Count L3, each on a
// race picked at random from those with that graphic.
// Only races with votes on air are shown, judged as each ticker slot or overlay begins so
// a graphic never changes race while it's up. Until any race has votes the ticker is
// down, and `waiting` counts down to the first.
// The numbers in them trail the night by AIR_LAG_MS, as graphics trail DDHQ — unless
// resolveResult is a source with no notion of lag (liveResultFor), which just ignores it.
// An airing may have something wrong with it (faults.ts); `fault` says what.

export type OnAir = {
	overlay: ({ kind: OverlayKind; raceKey: string } & Aired) | null;
	ticker: ({ raceKey: string } & Aired) | null;
	// Set while the ticker is down for want of votes: how long until it comes up, or null
	// when the night can't say ahead (DDHQ's live numbers, a recording paused before them).
	waiting: { firstResultsInMs: null | number } | null;
};

export type Overlay = {
	hideAtMs: number;
	index: number;
	kind: OverlayKind;
	plan: RacePlan;
	showAtMs: number;
};

export type OverlayKind = 'fs' | 'l3';

const hasVotesOnAir = (plan: RacePlan, elapsedMs: number, resolveResult: ResultResolver): boolean =>
	resolveResult(plan, elapsedMs - AIR_LAG_MS).totalVotes > 0;

const tickerMs = (night: Night): number => night.schedule.tickerSeconds * 1000;

const tickerSlot = (night: Night, elapsedMs: number): number =>
	Math.floor(elapsedMs / tickerMs(night));

const tickerPlan = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver,
): RacePlan | undefined => {
	const slot = tickerSlot(night, elapsedMs);
	const pass = Math.floor(slot / night.plans.length);
	const reporting = shuffle(makeRandom(seedFrom(night.seed, 'ticker', pass)), night.plans).filter(
		(plan) => hasVotesOnAir(plan, slot * tickerMs(night), resolveResult),
	);
	return reporting[slot % reporting.length];
};

// When the ticker first comes up: the first slot to begin with a race's votes on air.
// Votes only rise, so that slot is searched for, up to the one after the night ends, when
// every race has its final numbers.
const tickerUpInMs = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver,
): null | number => {
	const reportingAt = (slot: number) =>
		night.plans.some((plan) => hasVotesOnAir(plan, slot * tickerMs(night), resolveResult));
	const search = (low: number, high: number): number => {
		if (high - low <= 1) return high;
		const middle = Math.floor((low + high) / 2);
		return reportingAt(middle) ? search(low, middle) : search(middle, high);
	};
	const current = tickerSlot(night, elapsedMs);
	const last = Math.max(current, tickerSlot(night, night.durationMs + AIR_LAG_MS)) + 1;
	return reportingAt(last) ? search(current, last) * tickerMs(night) - elapsedMs : null;
};

const cycleMs = (night: Night): number =>
	(night.schedule.gapSeconds + night.schedule.overlaySeconds) * 1000;

// Cycle `index` runs from index × cycleMs: its gap, then its overlay. With no race of
// its kind reporting when it would come up, the cycle has none.
const overlayNumber = (
	night: Night,
	index: number,
	resolveResult: ResultResolver,
): Overlay | undefined => {
	const mix = night.schedule.fsCount + night.schedule.l3Count;
	if (mix === 0) return undefined;
	const kind: OverlayKind = index % mix < night.schedule.fsCount ? 'fs' : 'l3';
	const showAtMs = index * cycleMs(night) + night.schedule.gapSeconds * 1000;
	const plan = pick(
		makeRandom(seedFrom(night.seed, 'overlay', index)),
		night.plans.filter(
			(candidate) =>
				candidate.race.graphics.includes(kind) && hasVotesOnAir(candidate, showAtMs, resolveResult),
		),
	);
	return plan === undefined
		? undefined
		: { hideAtMs: showAtMs + night.schedule.overlaySeconds * 1000, index, kind, plan, showAtMs };
};

// The overlay on air at a moment, or the one coming up in the gap before it.
const overlayCycle = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver,
): Overlay | undefined =>
	overlayNumber(night, Math.floor(elapsedMs / cycleMs(night)), resolveResult);

export const overlayAt = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver = raceAt,
): Overlay | undefined => {
	const cycle = overlayCycle(night, elapsedMs, resolveResult);
	return cycle === undefined || elapsedMs < cycle.showAtMs ? undefined : cycle;
};

export const nextOverlay = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver = raceAt,
): Overlay | undefined => {
	const index = Math.floor(elapsedMs / cycleMs(night));
	const cycle = overlayNumber(night, index, resolveResult);
	return cycle !== undefined && elapsedMs < cycle.showAtMs
		? cycle
		: overlayNumber(night, index + 1, resolveResult);
};

export const onAirAt = (
	night: Night,
	elapsedMs: number,
	resolveResult: ResultResolver = raceAt,
): OnAir => {
	const ticker = tickerPlan(night, elapsedMs, resolveResult);
	const overlay = overlayAt(night, elapsedMs, resolveResult);
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
		ticker:
			ticker === undefined
				? null
				: {
						...airedGraphic(
							night,
							ticker,
							`ticker ${tickerSlot(night, elapsedMs)}`,
							elapsedMs,
							resolveResult,
						),
						raceKey: ticker.race.key,
					},
		waiting:
			ticker === undefined
				? { firstResultsInMs: tickerUpInMs(night, elapsedMs, resolveResult) }
				: null,
	};
};
