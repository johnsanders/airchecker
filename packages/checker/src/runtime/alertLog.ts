import type { Anomaly, Owner, RaceObservation, Severity } from '../reconcile/reconcile.js';

import { normalizeName } from '../reconcile/reconcile.js';

// Append-only history of what the air reads found. Each read of a race on a graphic is
// held against the previous read of that race on that graphic: a finding it didn't have
// is raised, one it no longer has is cleared. So a mismatch that stays on air is one
// event, not one per capture, and what the list shows now is never all there is to know:
// the events stay in a bounded in-memory ring for the web view, and go out through
// onEvent to the recorder and the structured log.
export type AlertEvent = {
	detail: string;
	// A raise keeps copies of the observations it compared: the race's current state
	// moves on as the sources catch up, but the alert is a record of what disagreed.
	evidence?: Anomaly['involves'];
	kind: 'cleared' | 'raised';
	owner: Owner;
	raceKey: string;
	severity: Severity;
	subject?: string;
	ts: number;
	type: Anomaly['type'];
};

export type AlertLog = {
	clear: () => void;
	// Newest first.
	recent: (limit?: number) => AlertEvent[];
	record: (airObservation: RaceObservation, anomalies: Anomaly[]) => AlertEvent[];
};

export type AlertLogConfig = {
	capacity?: number;
	onEvent?: (event: AlertEvent) => void;
};

const DEFAULT_CAPACITY = 1_000;

// `detail` carries figures that move; what a finding is about doesn't. A subject is a
// candidate's name as that read spelled it, and one read's "KEN PAXTON" is the next one's
// "Ken Paxton".
const identityOf = (anomaly: Anomaly): string =>
	`${anomaly.type}|${normalizeName(anomaly.subject ?? '')}`;

const toEvent = (anomaly: Anomaly, kind: AlertEvent['kind'], ts: number): AlertEvent => ({
	detail: anomaly.detail,
	...(kind === 'raised' ? { evidence: structuredClone(anomaly.involves) } : {}),
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
	const standing = new Map<string, Map<string, Anomaly>>();
	return {
		clear: () => {
			ring.length = 0;
			standing.clear();
		},
		recent: (limit = 100) => ring.slice(-limit).reverse(),
		record: (airObservation, anomalies) => {
			const graphic = `${airObservation.raceKey} ${airObservation.templateId ?? ''}`;
			const before = standing.get(graphic) ?? new Map<string, Anomaly>();
			const now = new Map(anomalies.map((anomaly) => [identityOf(anomaly), anomaly]));
			if (now.size === 0) standing.delete(graphic);
			else standing.set(graphic, now);

			const events = [
				...Array.from(now.entries())
					.filter(([identity]) => !before.has(identity))
					.map(([, anomaly]) => toEvent(anomaly, 'raised', airObservation.observedAt)),
				...Array.from(before.entries())
					.filter(([identity]) => !now.has(identity))
					.map(([, anomaly]) => toEvent(anomaly, 'cleared', airObservation.observedAt)),
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
