import type { RaceObservation, SourceName } from '../reconcile/reconcile.js';

export type Store = {
	getAirHistory: (raceKey: string) => RaceObservation[];
	getHistory: (source: SourceName, raceKey: string) => RaceObservation[];
	getProviderHistory: (raceKey: string) => RaceObservation[];
	getRaceKeys: () => string[];
	getVendorHistory: (raceKey: string) => RaceObservation[];
	record: (observation: RaceObservation) => void;
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

	const append = (observation: RaceObservation): void => {
		const bucket = buckets[observation.source];
		const list = bucket.get(observation.raceKey) ?? [];
		list.push(observation);
		const cutoff = observation.observedAt - retentionMs;
		while (list.length > 0 && list[0]!.observedAt < cutoff) list.shift();
		bucket.set(observation.raceKey, list);
		config.onRecord?.(observation);
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
	};
};

export default makeStore;
