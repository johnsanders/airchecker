import type { Anomaly } from '../reconcile/reconcile.js';

// Holds the current anomalies per race for the web view. Reconciliation re-runs on
// every poll/capture, so appending its output would re-add a standing anomaly each
// time (with a fresh timestamp) and never drop a resolved one. Tracking by race and
// replacing on each update keeps every anomaly represented once, clears a race that
// reconciles clean, and bounds the set by active races rather than by time.
export type AnomalyTracker = {
	list: () => Anomaly[];
	update: (raceKey: string, anomalies: Anomaly[]) => void;
};

export const makeAnomalyTracker = (): AnomalyTracker => {
	const byRace = new Map<string, Anomaly[]>();
	return {
		// Oldest first, so the web layer's slice(-100).reverse() keeps newest-first.
		list: () =>
			Array.from(byRace.values())
				.flat()
				.sort((a, b) => a.observedAt - b.observedAt),
		update: (raceKey, anomalies) => {
			if (anomalies.length === 0) byRace.delete(raceKey);
			else byRace.set(raceKey, anomalies);
		},
	};
};
