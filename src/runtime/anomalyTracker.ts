import type { Anomaly } from '../reconcile/reconcile.js';
import type { Thresholds } from '../reconcile/thresholds.js';

import defaultThresholds from '../reconcile/thresholds.js';

// Holds the standing anomalies per race for the web view and applies hysteresis.
// Reconciliation re-runs on every poll/capture; a comparison anomaly must be seen
// on N distinct triggering observations before it is emitted (one VLM misread of a
// frame must not page anyone), and an emitted anomaly must be absent for M
// reconciles before it clears. Replacing a race's set on each update keeps every
// anomaly represented once and bounds the set by active races.
export type AnomalyDiff = { cleared: Anomaly[]; raised: Anomaly[] };

export type AnomalyTracker = {
	clear: () => void;
	list: () => Anomaly[];
	update: (raceKey: string, anomalies: Anomaly[]) => AnomalyDiff;
};

// Event anomalies are one-tick by construction (a drop between two consecutive
// polls); they cannot persist, so they emit on first sight.
const IMMEDIATE: ReadonlySet<Anomaly['type']> = new Set(['vote_drop']);

const identityOf = (anomaly: Anomaly): string =>
	`${anomaly.type}|${anomaly.raceKey}|${anomaly.subject ?? ''}`;

const involvesAir = (anomaly: Anomaly): boolean => (anomaly.involves.air?.length ?? 0) > 0;

// The observation whose arrival produced the anomaly. Re-running the same
// comparison because an unrelated source polled is not a fresh sighting.
const triggerAt = (anomaly: Anomaly): number =>
	anomaly.involves.air?.[0]?.observedAt ??
	anomaly.involves.vendor?.observedAt ??
	anomaly.involves.provider?.observedAt ??
	anomaly.observedAt;

type Standing = {
	cleanTicks: number;
	emitted: boolean;
	lastTriggerAt: number;
	latest: Anomaly;
	sightings: number;
};

export const makeAnomalyTracker = (thresholds: Thresholds = defaultThresholds): AnomalyTracker => {
	const byRace = new Map<string, Map<string, Standing>>();

	const requiredSightings = (anomaly: Anomaly): number => {
		if (IMMEDIATE.has(anomaly.type)) return 1;
		return involvesAir(anomaly) ? thresholds.airHysteresisN : thresholds.vendorHysteresisN;
	};

	return {
		clear: () => byRace.clear(),
		// Oldest first, so the web layer's slice(-100).reverse() keeps newest-first.
		list: () =>
			Array.from(byRace.values())
				.flatMap((standings) =>
					Array.from(standings.values())
						.filter((standing) => standing.emitted)
						.map((standing) => standing.latest),
				)
				.sort((a, b) => a.observedAt - b.observedAt),
		update: (raceKey, anomalies) => {
			const standings = byRace.get(raceKey) ?? new Map<string, Standing>();
			const raised: Anomaly[] = [];
			const cleared: Anomaly[] = [];
			const present = new Set<string>();

			anomalies.forEach((anomaly) => {
				const id = identityOf(anomaly);
				present.add(id);
				const at = triggerAt(anomaly);
				const prior = standings.get(id);
				const sightings =
					prior === undefined
						? 1
						: at > prior.lastTriggerAt
							? prior.sightings + 1
							: prior.sightings;
				const emitted = prior?.emitted === true || sightings >= requiredSightings(anomaly);
				if (emitted && prior?.emitted !== true) raised.push(anomaly);
				standings.set(id, {
					cleanTicks: 0,
					emitted,
					lastTriggerAt: Math.max(at, prior?.lastTriggerAt ?? at),
					latest: anomaly,
					sightings,
				});
			});

			Array.from(standings.entries())
				.filter(([id]) => !present.has(id))
				.forEach(([id, standing]) => {
					// Never surfaced: a clean reconcile breaks the streak outright.
					if (!standing.emitted) {
						standings.delete(id);
						return;
					}
					const cleanTicks = standing.cleanTicks + 1;
					if (cleanTicks >= thresholds.recoveryHysteresisM) {
						standings.delete(id);
						cleared.push(standing.latest);
					} else standings.set(id, { ...standing, cleanTicks });
				});

			if (standings.size === 0) byRace.delete(raceKey);
			else byRace.set(raceKey, standings);
			return { cleared, raised };
		},
	};
};
