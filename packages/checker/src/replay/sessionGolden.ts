import type {
	AnomalyType,
	Owner,
	RaceObservation,
	Severity,
	SourceName,
} from '../reconcile/reconcile.js';

import makeComposition from '../runtime/composition.js';

// A session golden freezes what the pipeline makes of a recorded timeline: the alert
// events it raises, what stands at the end, how many air races it linked, and what the
// store holds. It deliberately keeps no observations in its expectations: they would bloat
// the doc, and the frozen inputs already carry them.
export type FrozenAnomaly = {
	detail: string;
	observedAt: number;
	owner: Owner;
	raceKey: string;
	severity: Severity;
	type: AnomalyType;
};

export type ObservationBatch = { observations: RaceObservation[]; ts: number };

export type SessionExpectations = {
	alertEvents: { cleared: number; raised: number };
	// Every distinct thing an alert was raised for, in the order first raised.
	distinctAnomalies: FrozenAnomaly[];
	// What the latest read of each aired race found.
	finalAnomalies: FrozenAnomaly[];
	// Aired races by whether their latest read was linked to a race DDHQ or Ross reported.
	links: { linked: number; unlinked: number };
	store: {
		raceCount: number;
		retainedBySource: Record<string, number>;
	};
};

export type SessionGoldenDoc = {
	expected: SessionExpectations;
	name: string;
	observations: RaceObservation[];
	sessionId: string;
	span: { from: number; to: number };
};

const frozen = (anomaly: Omit<FrozenAnomaly, 'observedAt'>, observedAt: number): FrozenAnomaly => ({
	detail: anomaly.detail,
	observedAt,
	owner: anomaly.owner,
	raceKey: anomaly.raceKey,
	severity: anomaly.severity,
	type: anomaly.type,
});

const distinctKey = (anomaly: FrozenAnomaly): string =>
	JSON.stringify({ ...anomaly, observedAt: undefined });

// Sources stamp one observedAt per poll/capture, so grouping by identical observedAt
// recovers the original ingest batches. In time order: an air read is stamped when the
// frame was captured, seconds before it was read and recorded.
export const batchByObservedAt = (observations: RaceObservation[]): ObservationBatch[] =>
	Array.from(
		observations
			.reduce<Map<number, RaceObservation[]>>((batches, observation) => {
				const list = batches.get(observation.observedAt) ?? [];
				list.push(observation);
				return batches.set(observation.observedAt, list);
			}, new Map())
			.entries(),
	)
		.map(([ts, batched]) => ({ observations: batched, ts }))
		.sort((a, b) => a.ts - b.ts);

export const replaySessionTimeline = (observations: RaceObservation[]): SessionExpectations => {
	const composition = makeComposition({ alertCapacity: Number.MAX_SAFE_INTEGER });
	batchByObservedAt(observations).forEach((batch) => composition.ingest(batch.observations));

	const events = composition.alertLog.recent(Number.MAX_SAFE_INTEGER).reverse();
	const latest = composition.latestReads();
	const raceKeys = composition.store.getRaceKeys();
	const sources: SourceName[] = ['air', 'DDHQ', 'Ross'];

	return {
		alertEvents: {
			cleared: events.filter((event) => event.kind === 'cleared').length,
			raised: events.filter((event) => event.kind === 'raised').length,
		},
		distinctAnomalies: Array.from(
			new Map(
				events
					.filter((event) => event.kind === 'raised')
					.map((event) => frozen(event, event.ts))
					.reverse()
					.map((anomaly) => [distinctKey(anomaly), anomaly]),
			).values(),
		).reverse(),
		finalAnomalies: latest.flatMap((checked) =>
			checked.anomalies.map((anomaly) => frozen(anomaly, anomaly.observedAt)),
		),
		links: {
			linked: latest.filter(({ read }) => read.raceKey !== read.sourceRaceKey).length,
			unlinked: latest.filter(({ read }) => read.raceKey === read.sourceRaceKey).length,
		},
		store: {
			raceCount: raceKeys.length,
			retainedBySource: Object.fromEntries(
				sources.map((source) => [
					source,
					raceKeys.reduce(
						(total, raceKey) => total + composition.store.getHistory(source, raceKey).length,
						0,
					),
				]),
			),
		},
	};
};
