import type { RaceObservation, SourceName } from '../reconcile/reconcile.js';

export type Store = {
	getAirHistory: (raceKey: string) => RaceObservation[];
	getHistory: (source: SourceName, raceKey: string) => RaceObservation[];
	getProviderHistory: (raceKey: string) => RaceObservation[];
	getRaceKeys: () => string[];
	getVendorHistory: (raceKey: string) => RaceObservation[];
	record: (observation: RaceObservation) => void;
	rekeySourceRace: (
		source: SourceName,
		sourceRaceKey: string,
		canonicalRaceKey: string,
	) => { fromRaceKeys: string[]; toRaceKey: string; updated: number };
};

export type StoreConfig = {
	onRecord?: (observation: RaceObservation) => void;
	retentionMs?: number;
};

const DEFAULT_RETENTION_MS = 30 * 60 * 1_000;

const makeStore = (config: StoreConfig = {}): Store => {
	const retentionMs = config.retentionMs ?? DEFAULT_RETENTION_MS;
	const buckets: Record<SourceName, Map<string, RaceObservation[]>> = {
		air: new Map(),
		DDHQ: new Map(),
		Ross: new Map(),
	};
	const retained: RaceObservation[] = [];

	const rebuildBuckets = (): void => {
		Object.values(buckets).forEach((bucket) => bucket.clear());
		retained.forEach((observation) => {
			const bucket = buckets[observation.source];
			const list = bucket.get(observation.raceKey) ?? [];
			list.push(observation);
			bucket.set(observation.raceKey, list);
		});
	};

	const append = (observation: RaceObservation): void => {
		const stored = {
			...observation,
			sourceRaceKey: observation.sourceRaceKey ?? observation.raceKey,
		};
		retained.push(stored);
		const cutoff = observation.observedAt - retentionMs;
		for (let index = retained.length - 1; index >= 0; index -= 1) {
			if (retained[index]!.observedAt < cutoff) retained.splice(index, 1);
		}
		rebuildBuckets();
		config.onRecord?.(stored);
	};

	const getHistory = (source: SourceName, raceKey: string): RaceObservation[] => {
		const list = buckets[source].get(raceKey);
		return list === undefined ? [] : [...list];
	};

	return {
		getAirHistory: (raceKey) => getHistory('air', raceKey),
		getHistory,
		getProviderHistory: (raceKey) => getHistory('DDHQ', raceKey),
		getRaceKeys: () =>
			Array.from(new Set([...buckets.DDHQ.keys(), ...buckets.Ross.keys(), ...buckets.air.keys()])),
		getVendorHistory: (raceKey) => getHistory('Ross', raceKey),
		record: append,
		rekeySourceRace: (source, sourceRaceKey, canonicalRaceKey) => {
			const fromRaceKeys = new Set<string>();
			let updated = 0;
			retained.forEach((observation) => {
				const rawKey = observation.sourceRaceKey ?? observation.raceKey;
				if (observation.source !== source || rawKey !== sourceRaceKey) return;
				if (observation.raceKey !== canonicalRaceKey) {
					fromRaceKeys.add(observation.raceKey);
					observation.raceKey = canonicalRaceKey;
					updated += 1;
				}
				observation.sourceRaceKey = sourceRaceKey;
			});
			if (updated > 0) rebuildBuckets();
			return { fromRaceKeys: Array.from(fromRaceKeys), toRaceKey: canonicalRaceKey, updated };
		},
	};
};

export default makeStore;
