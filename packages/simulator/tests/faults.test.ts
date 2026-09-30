import { describe, expect, it } from 'vitest';

import type { FaultKind } from '../src/air/faults.js';
import type { OnAir } from '../src/air/schedule.js';

import { FAULT_KINDS, STALE_MS } from '../src/air/faults.js';
import { AIR_LAG_MS, graphicData, makeNight, raceAt } from '../src/air/night.js';
import { loadRaces } from '../src/air/races.js';
import { onAirAt } from '../src/air/schedule.js';
import { DEFAULT_AIR_SCHEDULE } from '../src/settings.js';

const races = loadRaces('races.json');
const DURATION_MS = 30 * 60_000;
const clean = makeNight(races, 7, DURATION_MS);
const faulty = makeNight(races, 7, DURATION_MS, 1);
const half = makeNight(races, 7, DURATION_MS, 0.5);
const TICKER_SLOT_MS = DEFAULT_AIR_SCHEDULE.tickerSeconds * 1000;

// Every ticker slot of the night, sampled one second in.
const slots = Array.from({ length: DURATION_MS / TICKER_SLOT_MS }, (_, slot) => slot).map(
	(slot) => slot * TICKER_SLOT_MS + 1_000,
);

const tickers = (
	night: typeof clean,
	kind?: FaultKind,
): { ms: number; ticker: OnAir['ticker'] }[] =>
	slots
		.map((ms) => ({ ms, ticker: onAirAt(night, ms).ticker }))
		.filter(({ ticker }) => kind === undefined || ticker.fault?.kind === kind);

// What the race's graphic would show at that moment with nothing wrong.
const truth = (night: typeof clean, ms: number): OnAir['ticker']['data'] =>
	onAirAt({ ...night, faultRate: 0 }, ms).ticker.data;

describe('a night with no faults', () => {
	it('airs every graphic as the night has it', () =>
		tickers(clean).forEach(({ ms, ticker }) => {
			expect(ticker.fault).toBeNull();
			const plan = clean.plans.find((candidate) => candidate.race.key === ticker.raceKey)!;
			expect(ticker.data).toEqual(graphicData(plan, raceAt(plan, ms - AIR_LAG_MS)));
		}));
});

describe('a night with faults', () => {
	it('airs the same races at the same times, right or wrong', () =>
		expect(tickers(faulty).map(({ ticker }) => ticker.raceKey)).toEqual(
			tickers(clean).map(({ ticker }) => ticker.raceKey),
		));

	it('puts something wrong on about the share of airings asked for', () => {
		const wrong = tickers(half).filter(({ ticker }) => ticker.fault !== null).length;
		expect(wrong / slots.length).toBeGreaterThan(0.35);
		expect(wrong / slots.length).toBeLessThan(0.55);
	});

	it('uses every kind of fault', () =>
		expect(new Set(tickers(faulty).map(({ ticker }) => ticker.fault?.kind))).toEqual(
			new Set([...FAULT_KINDS, undefined]),
		));

	it('is the same night every time, from its seed', () =>
		expect(tickers(makeNight(races, 7, DURATION_MS, 1))).toEqual(tickers(faulty)));

	// Old figures are only wrong while newer ones exist, so a stale fault can come or go
	// when a drop lands, or when the last one turns five minutes old.
	it('keeps an airing wrong the same way for as long as it is up', () =>
		slots.forEach((ms) => {
			const [atFirst, atLast] = [ms, ms + TICKER_SLOT_MS - 1_500].map(
				(at) => onAirAt(faulty, at).ticker.fault?.kind,
			);
			const staleCameOrWent = [atFirst, atLast].every(
				(kind) => kind === 'stale' || kind === undefined,
			);
			if (!staleCameOrWent) expect(atLast).toBe(atFirst);
		}));

	it('leaves an airing clean when the fault would change nothing, and never calls one faulty that shows the truth', () =>
		tickers(faulty).forEach(({ ms, ticker }) => {
			if (ticker.fault === null) expect(ticker.data).toEqual(truth(faulty, ms));
			else expect(ticker.data).not.toEqual(truth(faulty, ms));
		}));

	it('faults overlays too', () => {
		const overlays = Array.from({ length: DURATION_MS / 1_000 }, (_, second) =>
			onAirAt(faulty, second * 1_000),
		).flatMap((onAir) => (onAir.overlay === null ? [] : [onAir.overlay]));
		expect(overlays.some((overlay) => overlay.fault !== null)).toBe(true);
	});
});

describe('each kind of fault changes one thing', () => {
	const changed = (kind: FaultKind): string[][] =>
		tickers(faulty, kind).map(({ ms, ticker }) => {
			const right = truth(faulty, ms);
			return [
				...(ticker.data.pctIn === right.pctIn ? [] : ['pctIn']),
				...(['cand1', 'cand2'] as const).flatMap((side) =>
					(['isWinner', 'name', 'votes', 'votePercent'] as const)
						.filter((field) => ticker.data[side][field] !== right[side][field])
						.map((field) => `${side}.${field}`),
				),
			];
		});

	it('votes: one candidate has more votes than they have, by at least 100', () => {
		changed('votes').forEach((fields) => expect(fields).toHaveLength(1));
		tickers(faulty, 'votes').forEach(({ ms, ticker }) => {
			const right = truth(faulty, ms);
			const off =
				ticker.data.cand1.votes - right.cand1.votes + ticker.data.cand2.votes - right.cand2.votes;
			expect(off).toBeGreaterThanOrEqual(100);
		});
	});

	it('pctIn: off by 3 points or more, or across the ">95" line', () => {
		changed('pctIn').forEach((fields) => expect(fields).toEqual(['pctIn']));
		tickers(faulty, 'pctIn').forEach(({ ms, ticker }) => {
			const right = truth(faulty, ms).pctIn;
			const points = (pctIn: string): number => (pctIn === '>95' ? 96 : Number(pctIn));
			expect(Math.abs(points(ticker.data.pctIn) - points(right))).toBeGreaterThanOrEqual(1);
			if (ticker.data.pctIn !== '>95' && right !== '>95')
				expect(Math.abs(points(ticker.data.pctIn) - points(right))).toBeGreaterThanOrEqual(3);
		});
	});

	it('stale: the whole graphic as it stood five minutes before', () =>
		tickers(faulty, 'stale').forEach(({ ms, ticker }) => {
			const plan = faulty.plans.find((candidate) => candidate.race.key === ticker.raceKey)!;
			expect(ticker.data).toEqual(graphicData(plan, raceAt(plan, ms - AIR_LAG_MS - STALE_MS)));
		}));

	it('check: one ✓, never on a candidate DDHQ has called by then', () =>
		tickers(faulty, 'check').forEach(({ ms, ticker }) => {
			const right = truth(faulty, ms);
			// DDHQ is ahead of the graphics by the air lag.
			const plan = faulty.plans.find((candidate) => candidate.race.key === ticker.raceKey)!;
			const called = graphicData(plan, raceAt(plan, ms));
			expect([ticker.data.cand1.isWinner, ticker.data.cand2.isWinner].filter(Boolean)).toEqual([
				true,
			]);
			if (called.cand1.isWinner) expect(ticker.data.cand2.isWinner).toBe(true);
			if (called.cand2.isWinner) expect(ticker.data.cand1.isWinner).toBe(true);
			expect(ticker.data.cand1.votes).toBe(right.cand1.votes);
		}));

	it('name: a surname with two neighboring letters swapped', () => {
		changed('name').forEach((fields) => {
			expect(fields).toHaveLength(1);
			expect(fields[0]).toMatch(/\.name$/);
		});
		tickers(faulty, 'name').forEach(({ ms, ticker }) => {
			const right = truth(faulty, ms);
			const side = ticker.data.cand1.name === right.cand1.name ? 'cand2' : 'cand1';
			const [first, shown = ''] = ticker.data[side].name.split('|');
			const [rightFirst, last = ''] = right[side].name.split('|');
			expect(first).toBe(rightFirst);
			expect([...shown].sort()).toEqual([...last].sort());
			expect(shown[0]).toBe(last[0]);
		});
	});
});
