// Seeded randomness, so a night (and what airs when) is a pure function of its seed.

export type Random = () => number; // uniform in [0, 1)

// FNV-1a over the parts, so each race or schedule slot gets its own independent stream.
export const seedFrom = (...parts: (number | string)[]): number =>
	[...parts.join('\u0000')].reduce(
		(hash, char) => Math.imul(hash ^ (char.codePointAt(0) ?? 0), 16_777_619) >>> 0,
		2_166_136_261,
	);

// mulberry32
export const makeRandom = (seed: number): Random => {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d_2b_79_f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
};

export const between = (random: Random, low: number, high: number): number =>
	low + random() * (high - low);

export const pick = <T>(random: Random, items: readonly T[]): T | undefined =>
	items[Math.floor(random() * items.length)];

export const shuffle = <T>(random: Random, items: readonly T[]): T[] =>
	items
		.map((item) => ({ item, sortKey: random() }))
		.sort((left, right) => left.sortKey - right.sortKey)
		.map((entry) => entry.item);
