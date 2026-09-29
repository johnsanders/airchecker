import type { GraphicData, Night, RacePlan, ResultResolver } from './night.js';
import type { Random } from './random.js';

import { AIR_LAG_MS, formatPctIn, graphicData } from './night.js';
import { between, makeRandom, pick, seedFrom } from './random.js';

// A night can put wrong graphics on air, which is what the checker exists to catch. A
// fault is one thing wrong with one airing of one graphic (a ticker slot, or an L3 or FS
// from the moment it comes up until it goes), while DDHQ and Chameleon go on saying what's
// true. Which airings are faulty, and how, comes from the night's seed like everything
// else, so airedAt() can say what was wrong with anything that aired.

export type Aired = { data: GraphicData; fault: Fault | null };

export type Fault = { kind: FaultKind; note: string };

//   votes  a candidate's vote total is wrong
//   pctIn  the % in is wrong
//   stale  the graphic never updated: it shows the race as it stood five minutes ago
//   check  a ✓ on a race nobody has called, or on the loser of one that has been. "Called"
//          is as DDHQ has it by now, not as the graphics would: a ✓ DDHQ made seconds ago
//          and the graphics haven't caught up with is early, not wrong.
//   name   a candidate's surname is misspelled
export type FaultKind = 'check' | 'name' | 'pctIn' | 'stale' | 'votes';

export const FAULT_KINDS: readonly FaultKind[] = ['check', 'name', 'pctIn', 'stale', 'votes'];

export const STALE_MS = 5 * 60_000;

type Side = 'cand1' | 'cand2';

type Subject = {
	data: GraphicData;
	latest: GraphicData; // the race as DDHQ has it by now, ahead of the graphics
	random: Random;
	stale: GraphicData; // the graphic as it would have read STALE_MS earlier
};

const whole = (value: number): string => Math.round(value).toLocaleString('en-US');

const side = (random: Random): Side => (random() < 0.5 ? 'cand1' : 'cand2');

const spoken = (name: string): string => name.replace('|', ' ');

const wrongVotes = ({ data, random }: Subject): Aired => {
	const which = side(random);
	const votes = data[which].votes;
	const shown = votes + Math.max(100, Math.round(votes * between(random, 0.01, 0.1)));
	return {
		data: { ...data, [which]: { ...data[which], votes: shown } },
		fault: {
			kind: 'votes',
			note: `${spoken(data[which].name)} has ${whole(votes)} votes, shown as ${whole(shown)}`,
		},
	};
};

// Off by 3 to 15 points, so never within the point of rounding the checker allows.
const wrongPctIn = ({ data, random }: Subject): Aired => {
	const pctIn = data.pctIn === '>95' ? 96 : Number(data.pctIn);
	const off = Math.round(between(random, 3, 15));
	const shown = formatPctIn(pctIn - off < 0 ? pctIn + off : pctIn - off);
	return {
		data: { ...data, pctIn: shown },
		fault: { kind: 'pctIn', note: `${data.pctIn}% in, shown as ${shown}%` },
	};
};

// Nothing is wrong with a graphic that shows old figures when none of them has changed.
const staleGraphic = ({ data, stale }: Subject): Aired | undefined =>
	data.cand1.votes === stale.cand1.votes && data.cand2.votes === stale.cand2.votes
		? undefined
		: {
				data: stale,
				fault: {
					kind: 'stale',
					note: `shown as it stood ${STALE_MS / 60_000} minutes before: ${whole(stale.cand1.votes)} and ${whole(stale.cand2.votes)} votes for ${whole(data.cand1.votes)} and ${whole(data.cand2.votes)}`,
				},
			};

const wrongCheck = ({ data, latest }: Subject): Aired => {
	const winner = (['cand1', 'cand2'] as const).find((which) => latest[which].isWinner);
	const leader: Side = data.cand1.votes >= data.cand2.votes ? 'cand1' : 'cand2';
	const checked: Side = winner === undefined ? leader : winner === 'cand1' ? 'cand2' : 'cand1';
	return {
		data: {
			...data,
			cand1: { ...data.cand1, isWinner: checked === 'cand1' },
			cand2: { ...data.cand2, isWinner: checked === 'cand2' },
		},
		fault: {
			kind: 'check',
			note:
				winner === undefined
					? `not called, shown with a ✓ for ${spoken(data[checked].name)}`
					: `called for ${spoken(data[winner].name)}, shown with the ✓ on ${spoken(data[checked].name)}`,
		},
	};
};

// Two neighboring letters of the surname change places: "Acton" airs as "Atcon".
const misspelledName = ({ data, random }: Subject): Aired | undefined => {
	const which = side(random);
	const [first = '', last = ''] = data[which].name.split('|');
	const swappable = Array.from({ length: Math.max(0, last.length - 2) }, (_, index) => index + 1)
		.filter((index) => last[index]?.toLowerCase() !== last[index + 1]?.toLowerCase())
		.filter((index) => /^\p{L}{2}$/u.test(last.slice(index, index + 2)));
	const at = pick(random, swappable);
	if (at === undefined) return undefined;
	const shown = `${last.slice(0, at)}${last[at + 1]}${last[at]}${last.slice(at + 2)}`;
	return {
		data: { ...data, [which]: { ...data[which], name: `${first}|${shown}` } },
		fault: { kind: 'name', note: `${first} ${last}, shown as ${first} ${shown}` },
	};
};

const FAULTS: Record<FaultKind, (subject: Subject) => Aired | undefined> = {
	check: wrongCheck,
	name: misspelledName,
	pctIn: wrongPctIn,
	stale: staleGraphic,
	votes: wrongVotes,
};

// What one airing of a race's graphic shows at a moment of the night. `airing` names the
// airing ("ticker 12", "overlay 5"): the same one is wrong the same way for as long as
// it's up. A fault that would change nothing leaves the airing clean.
export const airedGraphic = (
	night: Night,
	plan: RacePlan,
	airing: string,
	elapsedMs: number,
	resolveResult: ResultResolver,
): Aired => {
	const data = graphicData(plan, resolveResult(plan, elapsedMs - AIR_LAG_MS));
	const random = makeRandom(seedFrom(night.seed, 'fault', airing));
	if (random() >= night.faultRate) return { data, fault: null };
	const kind = pick(random, FAULT_KINDS) as FaultKind;
	const latest = graphicData(plan, resolveResult(plan, elapsedMs));
	const stale = graphicData(plan, resolveResult(plan, elapsedMs - AIR_LAG_MS - STALE_MS));
	return FAULTS[kind]({ data, latest, random, stale }) ?? { data, fault: null };
};
