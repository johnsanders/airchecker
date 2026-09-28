import type { GraphicData, Night, RacePlan } from './night.js';

import { AIR_LAG_MS, graphicData, raceAt } from './night.js';
import { between, makeRandom, pick, seedFrom, shuffle } from './random.js';

// What's on air at a moment of the night. The ticker is always up and moves to the next
// race every 8 s, through every race in a shuffled order that's reshuffled each pass.
// Over it, an L3 or FS comes up after a 10–20 s gap, holds 10 s, and the cycle repeats.
// The numbers in them trail the night by AIR_LAG_MS, as graphics trail DDHQ.

export const TICKER_SLOT_MS = 8_000;
export const OVERLAY_MS = 10_000;
export const OVERLAY_GAP_MIN_MS = 10_000;
export const OVERLAY_GAP_MAX_MS = 20_000;

export type OnAir = {
	overlay: { data: GraphicData; kind: OverlayKind; raceKey: string } | null;
	ticker: { data: GraphicData; raceKey: string };
};

export type OverlayKind = 'fs' | 'l3';

type OverlayCycle = { index: number; kind: OverlayKind; plan: RacePlan; showAtMs: number };

const tickerPlan = (night: Night, elapsedMs: number): RacePlan => {
	const slot = Math.floor(elapsedMs / TICKER_SLOT_MS);
	const pass = Math.floor(slot / night.plans.length);
	const order = shuffle(makeRandom(seedFrom(night.seed, 'ticker', pass)), night.plans);
	return order[slot % night.plans.length] as RacePlan;
};

const overlayCycle = (night: Night, index: number, startMs: number): OverlayCycle => {
	const random = makeRandom(seedFrom(night.seed, 'overlay', index));
	const kind: OverlayKind = random() < 0.5 ? 'l3' : 'fs';
	return {
		index,
		kind,
		plan: pick(
			random,
			night.plans.filter((plan) => plan.race.graphics.includes(kind)),
		) as RacePlan,
		showAtMs: startMs + between(random, OVERLAY_GAP_MIN_MS, OVERLAY_GAP_MAX_MS),
	};
};

// Walks the cycles from the top of the night: a few hundred steps hours in. A loop, not
// recursion, so a feed left running for days can't run out of stack.
const overlayAt = (night: Night, elapsedMs: number): OverlayCycle | undefined => {
	let cycle = overlayCycle(night, 0, 0);
	while (elapsedMs >= cycle.showAtMs + OVERLAY_MS)
		cycle = overlayCycle(night, cycle.index + 1, cycle.showAtMs + OVERLAY_MS);
	return elapsedMs < cycle.showAtMs ? undefined : cycle;
};

export const onAirAt = (night: Night, elapsedMs: number): OnAir => {
	const ticker = tickerPlan(night, elapsedMs);
	const overlay = overlayAt(night, elapsedMs);
	return {
		overlay:
			overlay === undefined
				? null
				: {
						data: graphicData(overlay.plan, raceAt(overlay.plan, elapsedMs - AIR_LAG_MS)),
						kind: overlay.kind,
						raceKey: overlay.plan.race.key,
					},
		ticker: {
			data: graphicData(ticker, raceAt(ticker, elapsedMs - AIR_LAG_MS)),
			raceKey: ticker.race.key,
		},
	};
};
