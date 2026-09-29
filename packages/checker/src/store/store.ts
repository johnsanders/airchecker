import type { RaceObservation, SourceName } from '../reconcile/reconcile.js';

import { observationChanged } from './observationChanged.js';

export type Store = {
	clear: () => void;
	getAirHistory: (raceKey: string) => RaceObservation[];
	getHistory: (source: SourceName, raceKey: string) => RaceObservation[];
	getProviderHistory: (raceKey: string) => RaceObservation[];
	getRaceKeys: () => string[];
	getVendorHistory: (raceKey: string) => RaceObservation[];
	// Returns the observation as stored, or undefined when it wasn't: DDHQ and Ross repeat
	// themselves every poll, and only what says something new is kept. So a source's history
	// of a race is the list of its changes, each stamped when it was first seen, and the
	// last one at or before a moment is what the source was saying at that moment. Every
	// air read is kept: each is a record of what was on screen.
	record: (observation: RaceObservation) => RaceObservation | undefined;
};

export type StoreConfig = {
	onRecord?: (observation: RaceObservation) => void;
	retentionMs?: number;
};

const DEFAULT_RETENTION_MS = 30 * 60 * 1_000;
// DDHQ and Ross are kept this much longer than air reads, so the oldest read still held
// has everything it was compared with: the lag windows behind it are minutes, not more.
const UPSTREAM_MARGIN_MS = 5 * 60 * 1_000;
const SOURCES: readonly SourceName[] = ['air', 'DDHQ', 'Ross'];

const makeStore = (config: StoreConfig = {}): Store => {
	const retentionMs = config.retentionMs ?? DEFAULT_RETENTION_MS;
	const buckets: Record<SourceName, Map<string, RaceObservation[]>> = {
		air: new Map(),
		DDHQ: new Map(),
		Ross: new Map(),
	};

	const prune = (now: number): void =>
		SOURCES.forEach((source) => {
			const cutoff = now - retentionMs - (source === 'air' ? 0 : UPSTREAM_MARGIN_MS);
			buckets[source].forEach((list, raceKey) => {
				const firstKept = list.findIndex((observation) => observation.observedAt >= cutoff);
				const expired = firstKept === -1 ? list.length : firstKept;
				// The last thing DDHQ or Ross said before the cutoff was still what it was
				// saying at the cutoff, however long ago it was first seen.
				list.splice(0, source === 'air' ? expired : expired - 1);
				if (list.length === 0) buckets[source].delete(raceKey);
			});
		});

	const getHistory = (source: SourceName, raceKey: string): RaceObservation[] => [
		...(buckets[source].get(raceKey) ?? []),
	];

	return {
		clear: () => SOURCES.forEach((source) => buckets[source].clear()),
		getAirHistory: (raceKey) => getHistory('air', raceKey),
		getHistory,
		getProviderHistory: (raceKey) => getHistory('DDHQ', raceKey),
		getRaceKeys: () =>
			Array.from(new Set([...buckets.DDHQ.keys(), ...buckets.Ross.keys(), ...buckets.air.keys()])),
		getVendorHistory: (raceKey) => getHistory('Ross', raceKey),
		record: (observation) => {
			const bucket = buckets[observation.source];
			const list = bucket.get(observation.raceKey) ?? [];
			if (observation.source !== 'air' && !observationChanged(list.at(-1), observation))
				return undefined;
			const stored = {
				...observation,
				sourceRaceKey: observation.sourceRaceKey ?? observation.raceKey,
			};
			list.push(stored);
			bucket.set(observation.raceKey, list);
			prune(observation.observedAt);
			config.onRecord?.(stored);
			return stored;
		},
	};
};

export default makeStore;
