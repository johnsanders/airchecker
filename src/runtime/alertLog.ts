import type { Anomaly, Owner, Severity } from '../reconcile/reconcile.js';
import type { AnomalyDiff } from './anomalyTracker.js';

// Append-only history of alert transitions. Standing alerts clear on the next
// clean poll (the primary-night audit saw all nine real alerts vanish within a
// minute), so an operator who blinks misses them; this keeps every raise and clear
// as an event — in a bounded in-memory ring for the web view, and via onEvent for
// the recorder and the structured log.
export type AlertEvent = {
	detail: string;
	kind: 'cleared' | 'raised';
	owner: Owner;
	raceKey: string;
	severity: Severity;
	subject?: string;
	ts: number;
	type: Anomaly['type'];
};

export type AlertLog = {
	// Newest first.
	recent: (limit?: number) => AlertEvent[];
	record: (diff: AnomalyDiff, ts: number) => AlertEvent[];
};

export type AlertLogConfig = {
	capacity?: number;
	onEvent?: (event: AlertEvent) => void;
};

const DEFAULT_CAPACITY = 1_000;

const toEvent = (anomaly: Anomaly, kind: AlertEvent['kind'], ts: number): AlertEvent => ({
	detail: anomaly.detail,
	kind,
	owner: anomaly.owner,
	raceKey: anomaly.raceKey,
	severity: anomaly.severity,
	...(anomaly.subject === undefined ? {} : { subject: anomaly.subject }),
	ts,
	type: anomaly.type,
});

export const makeAlertLog = (config: AlertLogConfig = {}): AlertLog => {
	const capacity = config.capacity ?? DEFAULT_CAPACITY;
	const ring: AlertEvent[] = [];
	return {
		recent: (limit = 100) => ring.slice(-limit).reverse(),
		record: (diff, ts) => {
			const events = [
				...diff.raised.map((anomaly) => toEvent(anomaly, 'raised', ts)),
				...diff.cleared.map((anomaly) => toEvent(anomaly, 'cleared', ts)),
			];
			events.forEach((event) => {
				ring.push(event);
				config.onEvent?.(event);
			});
			if (ring.length > capacity) ring.splice(0, ring.length - capacity);
			return events;
		},
	};
};
