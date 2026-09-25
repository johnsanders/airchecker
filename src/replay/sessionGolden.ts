import type { RaceIdentityEvent } from '../identity/raceIdentity.js';
import type {
	Anomaly,
	AnomalyType,
	Owner,
	RaceObservation,
	Severity,
	SourceName,
} from '../reconcile/reconcile.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import { makeAnomalyTracker } from '../runtime/anomalyTracker.js';
import makeComposition from '../runtime/composition.js';

// A session golden freezes what the store + reconciler emit over a recorded
// timeline. It deliberately drops Anomaly.involves — full observations there
// would bloat the doc, and the frozen inputs already carry them.
export type FrozenAnomaly = {
	detail: string;
	observedAt: number;
	owner: Owner;
	raceKey: string;
	severity: Severity;
	type: AnomalyType;
};

export type SessionExpectations = {
	distinctAnomalies: FrozenAnomaly[];
	finalAnomalies: FrozenAnomaly[];
	identity: {
		aliasesByMethod: Record<string, number>;
		canonicalCount: number;
		proposalsByStatus: Record<string, number>;
		provisionalCount: number;
	};
	store: {
		raceCount: number;
		retainedBySource: Record<string, number>;
	};
};

export type SessionGoldenDoc = {
	expected: SessionExpectations;
	identityEvents: TimedIdentityEvent[];
	name: string;
	observations: RaceObservation[];
	sessionId: string;
	span: { from: number; to: number };
};

export type SessionTimelineInputs = {
	identityEvents: TimedIdentityEvent[];
	observations: RaceObservation[];
};

export type TimedIdentityEvent = { event: RaceIdentityEvent; ts: number };

type ObservationBatch = { observations: RaceObservation[]; ts: number };

const toFrozenAnomaly = (anomaly: Anomaly): FrozenAnomaly => ({
	detail: anomaly.detail,
	observedAt: anomaly.observedAt,
	owner: anomaly.owner,
	raceKey: anomaly.raceKey,
	severity: anomaly.severity,
	type: anomaly.type,
});

const distinctKey = (anomaly: Anomaly): string =>
	JSON.stringify({
		detail: anomaly.detail,
		owner: anomaly.owner,
		raceKey: anomaly.raceKey,
		severity: anomaly.severity,
		type: anomaly.type,
	});

const countBy = <T>(items: T[], keyOf: (item: T) => string): Record<string, number> =>
	Object.fromEntries(
		Object.entries(
			items.reduce<Record<string, number>>((counts, item) => {
				counts[keyOf(item)] = (counts[keyOf(item)] ?? 0) + 1;
				return counts;
			}, {}),
		).sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1)),
	);

// Sources stamp one observedAt per poll/capture, so grouping by identical
// observedAt recovers the original ingest batches.
const batchByObservedAt = (observations: RaceObservation[]): ObservationBatch[] =>
	Array.from(
		observations
			.reduce<Map<number, RaceObservation[]>>((batches, observation) => {
				const list = batches.get(observation.observedAt) ?? [];
				list.push(observation);
				return batches.set(observation.observedAt, list);
			}, new Map())
			.entries(),
	).map(([ts, batched]) => ({ observations: batched, ts }));

export const replaySessionTimeline = (inputs: SessionTimelineInputs): SessionExpectations => {
	const composition = makeComposition();
	const tracker = makeAnomalyTracker(composition.thresholds);
	const resolver = makeRaceIdentityResolver();
	const distinct = new Map<string, FrozenAnomaly>();

	const reconcileKeys = (raceKeys: string[], now: number): void => {
		Array.from(new Set(raceKeys)).forEach((raceKey) => {
			// "Everything that would have alerted" = what the tracker emitted after
			// hysteresis, not the raw rule output.
			const diff = tracker.update(raceKey, composition.reconcileRace(raceKey, now));
			diff.raised.forEach((anomaly) => {
				const key = distinctKey(anomaly);
				if (!distinct.has(key)) distinct.set(key, toFrozenAnomaly(anomaly));
			});
		});
	};

	const applyBatch = (batch: ObservationBatch): void => {
		batch.observations.forEach(composition.store.record);
		reconcileKeys(
			batch.observations.map((observation) => observation.raceKey),
			batch.ts,
		);
	};

	const applyIdentityEvent = (timed: TimedIdentityEvent): void => {
		resolver.applyEvent(timed.event);
		if (timed.event.type !== 'alias_upsert') return;
		const result = composition.store.rekeySourceRace(
			timed.event.payload.source,
			timed.event.payload.sourceRaceKey,
			timed.event.payload.canonicalRaceKey,
		);
		if (result.fromRaceKeys.length === 0) return; // nothing actually re-bucketed
		reconcileKeys([...result.fromRaceKeys, result.toRaceKey], timed.ts);
	};

	// Stable merge; on a ts tie the observation batch is processed before events.
	const timeline = [
		...batchByObservedAt(inputs.observations).map((batch) => ({
			batch,
			kind: 'batch' as const,
			ts: batch.ts,
		})),
		...inputs.identityEvents.map((timed) => ({
			event: timed,
			kind: 'event' as const,
			ts: timed.ts,
		})),
	].sort((a, b) => a.ts - b.ts || (a.kind === 'batch' ? 0 : 1) - (b.kind === 'batch' ? 0 : 1));

	timeline.forEach((item) => {
		if (item.kind === 'batch') applyBatch(item.batch);
		else applyIdentityEvent(item.event);
	});

	const snapshot = resolver.getSnapshot();
	const raceKeys = composition.store.getRaceKeys();
	const sources: SourceName[] = ['air', 'DDHQ', 'Ross'];

	return {
		distinctAnomalies: Array.from(distinct.values()),
		finalAnomalies: tracker.list().map(toFrozenAnomaly),
		identity: {
			aliasesByMethod: countBy(snapshot.aliases, (alias) => alias.method),
			canonicalCount: snapshot.canonicalRaces.length,
			proposalsByStatus: countBy(snapshot.proposals, (proposal) => proposal.status),
			provisionalCount: snapshot.canonicalRaces.filter((race) => race.provisional).length,
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
