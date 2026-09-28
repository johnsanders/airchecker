import type { Anomaly, RaceObservation } from '../reconcile/reconcile.js';
import type { Thresholds } from '../reconcile/thresholds.js';
import type { Store } from '../store/store.js';

import reconcile from '../reconcile/reconcile.js';
import defaultThresholds from '../reconcile/thresholds.js';
import makeStore from '../store/store.js';

export type Composition = {
	reconcileRace: (raceKey: string, now: number) => Anomaly[];
	store: Store;
	thresholds: Thresholds;
};

export type CompositionConfig = {
	onRecord?: (observation: RaceObservation) => void;
	retentionMs?: number;
	thresholds?: Thresholds;
};

const makeComposition = (config: CompositionConfig = {}): Composition => {
	const thresholds = config.thresholds ?? defaultThresholds;
	const storeOptions: Parameters<typeof makeStore>[0] = {};
	if (config.retentionMs !== undefined) storeOptions.retentionMs = config.retentionMs;
	if (config.onRecord !== undefined) storeOptions.onRecord = config.onRecord;
	const store = makeStore(storeOptions);

	const reconcileRace = (raceKey: string, now: number): Anomaly[] =>
		reconcile({
			airHistory: store.getAirHistory(raceKey),
			now,
			providerHistory: store.getProviderHistory(raceKey),
			raceKey,
			thresholds,
			vendorHistory: store.getVendorHistory(raceKey),
		});

	return { reconcileRace, store, thresholds };
};

export default makeComposition;
