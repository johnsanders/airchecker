import type { Anomaly, RaceObservation } from '../reconcile/reconcile.js';
import type { Thresholds } from '../reconcile/thresholds.js';
import type { Store } from '../store/store.js';
import type { AlertEvent, AlertLog } from './alertLog.js';

import { linkObservation } from '../identity/linkRace.js';
import reconcile, { comparedVendorState } from '../reconcile/reconcile.js';
import defaultThresholds from '../reconcile/thresholds.js';
import makeStore from '../store/store.js';
import { makeAlertLog } from './alertLog.js';

// The whole pipeline, shared by live, replay and the session goldens: observations are
// linked to their race and stored; each air read is then checked once, against what Ross
// and DDHQ had said by the time it was read, and what that finds goes to the alert log.
// Nothing else is ever evaluated: a DDHQ or Ross poll only adds to what later reads are
// checked against.

// An air read held against its sources as they stood when it was read. Later polls don't
// change it, so it is a record: a mismatch stays one after the source catches up.
export type CheckedRead = {
	anomalies: Anomaly[];
	provider?: RaceObservation; // what DDHQ was saying
	read: RaceObservation;
	vendor?: RaceObservation; // the Ross state the read was held against
};

export type Composition = {
	alertLog: AlertLog;
	ingest: (observations: RaceObservation[]) => Ingested;
	// Each race read off air, once, as its latest read, newest first.
	latestReads: () => CheckedRead[];
	// Every read of the race still held, newest first.
	readsOf: (raceKey: string) => CheckedRead[];
	// Forgets everything observed and every alert. The store always keeps the last thing
	// DDHQ and Ross said of a race, so without this a rehearsal's figures would stand in a
	// later session for any race the sources hadn't yet reported again.
	reset: () => void;
	store: Store;
	thresholds: Thresholds;
};

export type CompositionConfig = {
	alertCapacity?: number; // alert events kept in memory; the alert log's default otherwise
	onAlertEvent?: (event: AlertEvent) => void;
	onRecord?: (observation: RaceObservation) => void;
	retentionMs?: number;
	thresholds?: Thresholds;
};

export type Ingested = {
	events: AlertEvent[];
	observations: RaceObservation[]; // every observation passed in, linked to its race
	recorded: RaceObservation[]; // those of them that said something new
};

const makeComposition = (config: CompositionConfig = {}): Composition => {
	const thresholds = config.thresholds ?? defaultThresholds;
	const store = makeStore({
		...(config.onRecord === undefined ? {} : { onRecord: config.onRecord }),
		...(config.retentionMs === undefined ? {} : { retentionMs: config.retentionMs }),
	});
	const alertLog = makeAlertLog({
		...(config.alertCapacity === undefined ? {} : { capacity: config.alertCapacity }),
		...(config.onAlertEvent === undefined ? {} : { onEvent: config.onAlertEvent }),
	});

	// `airObservation` is one the store returned: it is found in its history by identity.
	const checkRead = (airObservation: RaceObservation): CheckedRead => {
		const saidBy = (history: RaceObservation[]): RaceObservation[] =>
			history.filter((observation) => observation.observedAt <= airObservation.observedAt);
		const airHistory = store.getAirHistory(airObservation.raceKey);
		const providerHistory = saidBy(store.getProviderHistory(airObservation.raceKey));
		const vendorHistory = saidBy(store.getVendorHistory(airObservation.raceKey));
		const provider = providerHistory.at(-1);
		const vendor = comparedVendorState(airObservation, vendorHistory, thresholds);
		return {
			anomalies: reconcile({
				airHistory: airHistory.slice(0, airHistory.indexOf(airObservation) + 1),
				now: airObservation.observedAt,
				providerHistory,
				raceKey: airObservation.raceKey,
				thresholds,
				vendorHistory,
			}),
			...(provider === undefined ? {} : { provider }),
			read: airObservation,
			...(vendor === undefined ? {} : { vendor }),
		};
	};

	const readsOf = (raceKey: string): CheckedRead[] =>
		store.getAirHistory(raceKey).map(checkRead).reverse();

	// One frame can show a race on two graphics. Whichever of them has something wrong
	// stands for the race, so a clean ticker can't hide a bad lower third.
	const latestRead = (raceKey: string): CheckedRead | undefined => {
		const reads = readsOf(raceKey);
		return reads
			.filter((checked) => checked.read.observedAt === reads[0]?.read.observedAt)
			.reduce<CheckedRead | undefined>(
				(worst, next) =>
					worst === undefined || next.anomalies.length > worst.anomalies.length ? next : worst,
				undefined,
			);
	};

	const ingest = (observations: RaceObservation[]): Ingested => {
		const raceKeys = store.getRaceKeys();
		const known = {
			provider: raceKeys.flatMap((raceKey) => store.getProviderHistory(raceKey).at(-1) ?? []),
			vendor: raceKeys.flatMap((raceKey) =>
				store.getProviderHistory(raceKey).length > 0
					? []
					: (store.getVendorHistory(raceKey).at(-1) ?? []),
			),
		};
		const linked = observations.map((observation) => linkObservation(observation, known));
		const recorded = linked.flatMap((observation) => store.record(observation) ?? []);
		const events = recorded
			.filter((observation) => observation.source === 'air')
			.flatMap((airObservation) =>
				alertLog.record(airObservation, checkRead(airObservation).anomalies),
			);
		return { events, observations: linked, recorded };
	};

	return {
		alertLog,
		ingest,
		latestReads: () =>
			store
				.getRaceKeys()
				.flatMap((raceKey) => latestRead(raceKey) ?? [])
				.sort(
					(a, b) =>
						b.read.observedAt - a.read.observedAt || a.read.raceKey.localeCompare(b.read.raceKey),
				),
		readsOf,
		reset: () => {
			store.clear();
			alertLog.clear();
		},
		store,
		thresholds,
	};
};

export default makeComposition;
