import type { Thresholds } from './thresholds.js';

export type Anomaly = {
	detail: string;
	involves: {
		air?: RaceObservation[];
		provider?: RaceObservation;
		vendor?: RaceObservation;
	};
	observedAt: number;
	owner: Owner;
	raceKey: string;
	severity: Severity;
	type: AnomalyType;
};

export type AnomalyType =
	| 'air_ahead_of_upstream'
	| 'call_mismatch'
	| 'cross_surface_mismatch'
	| 'missing_call'
	| 'name_mismatch'
	| 'pct_in_mismatch'
	| 'premature_call'
	| 'vote_drop'
	| 'votes_mismatch';

export type CandidateState = {
	key: string;
	name: string;
	party: string;
	pct: number;
	votes: number;
};

export type Owner = 'observe' | 'provider' | 'us' | 'vendor';

export type RaceObservation = {
	calledFor: string[]; // candidate keys called/advancing; empty = none. Multiple for top-2 races.
	candidates: CandidateState[];
	extractedFields?: Record<string, string>;
	observedAt: number;
	pctIn: number;
	raceKey: string;
	reportedAt: null | number;
	source: SourceName;
	templateId?: string;
};

export type ReconcileInput = {
	airHistory: RaceObservation[];
	now: number;
	providerHistory: RaceObservation[];
	raceKey: string;
	thresholds: Thresholds;
	vendorHistory: RaceObservation[];
};

export type Severity = 'high' | 'low' | 'medium';

export type SourceName = 'air' | 'DDHQ' | 'Ross';

const normalizeName = (name: string): string =>
	name
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]/g, '');

const latest = (history: RaceObservation[]): RaceObservation | undefined =>
	history.length === 0 ? undefined : history[history.length - 1];

const findNearest = (
	history: RaceObservation[],
	targetTime: number,
	windowMs: number,
): RaceObservation | undefined =>
	history
		.filter((observation) => Math.abs(observation.observedAt - targetTime) <= windowMs)
		.reduce<RaceObservation | undefined>((best, observation) => {
			if (best === undefined) return observation;
			return Math.abs(observation.observedAt - targetTime) < Math.abs(best.observedAt - targetTime)
				? observation
				: best;
		}, undefined);

const observationsInWindow = (
	history: RaceObservation[],
	fromTime: number,
	toTime: number,
): RaceObservation[] =>
	history.filter(
		(observation) => observation.observedAt >= fromTime && observation.observedAt <= toTime,
	);

const candidateBy = (observation: RaceObservation, key: string): CandidateState | undefined =>
	observation.candidates.find((candidate) => candidate.key === key);

const candidateByNormalizedName = (
	observation: RaceObservation,
	name: string,
): CandidateState | undefined => {
	const target = normalizeName(name);
	return observation.candidates.find((candidate) => normalizeName(candidate.name) === target);
};

const findMatchingCandidate = (
	observation: RaceObservation,
	target: CandidateState,
): CandidateState | undefined =>
	candidateBy(observation, target.key) ?? candidateByNormalizedName(observation, target.name);

const checkNameAgreement = (
	raceKey: string,
	airObservation: RaceObservation,
	upstream: RaceObservation,
	upstreamSource: 'DDHQ' | 'Ross',
): Anomaly[] =>
	airObservation.candidates.flatMap((airCandidate) => {
		const match = candidateByNormalizedName(upstream, airCandidate.name);
		if (match !== undefined) return [];
		const involves: Anomaly['involves'] =
			upstreamSource === 'DDHQ'
				? { air: [airObservation], provider: upstream }
				: { air: [airObservation], vendor: upstream };
		return [
			{
				detail: `Candidate name on air ("${airCandidate.name}") not found in ${upstreamSource} roster`,
				involves,
				observedAt: airObservation.observedAt,
				owner: 'us' as const,
				raceKey,
				severity: 'high' as const,
				type: 'name_mismatch' as const,
			},
		];
	});

const checkAirBehindOrAhead = (
	raceKey: string,
	airObservation: RaceObservation,
	providerHistory: RaceObservation[],
	thresholds: Thresholds,
): Anomaly[] => {
	const earliestProviderAllowed = airObservation.observedAt - thresholds.lagSlackMs;
	const providerAfter = providerHistory.find(
		(observation) => observation.observedAt > earliestProviderAllowed,
	);
	if (providerAfter === undefined) return [];
	const airHasNewerData = airObservation.candidates.some((airCandidate) => {
		const upstreamCandidate = findMatchingCandidate(providerAfter, airCandidate);
		return upstreamCandidate !== undefined && airCandidate.votes > upstreamCandidate.votes;
	});
	if (!airHasNewerData) return [];
	return [
		{
			detail: 'Air shows vote totals higher than any provider snapshot seen yet',
			involves: { air: [airObservation], provider: providerAfter },
			observedAt: airObservation.observedAt,
			owner: 'observe',
			raceKey,
			severity: 'medium',
			type: 'air_ahead_of_upstream',
		},
	];
};

const checkVotesMatchInLagWindow = (
	raceKey: string,
	airObservation: RaceObservation,
	vendorHistory: RaceObservation[],
	thresholds: Thresholds,
): Anomaly[] => {
	const fromTime =
		airObservation.observedAt - thresholds.vendorToAirLagMaxMs - thresholds.lagSlackMs;
	const toTime = airObservation.observedAt - thresholds.vendorToAirLagMs + thresholds.lagSlackMs;
	const window = observationsInWindow(vendorHistory, fromTime, toTime);
	if (window.length === 0) return [];
	return airObservation.candidates.flatMap((airCandidate) => {
		const sawMatch = window.some((vendorObservation) => {
			const vendorCandidate = findMatchingCandidate(vendorObservation, airCandidate);
			return vendorCandidate !== undefined && vendorCandidate.votes === airCandidate.votes;
		});
		if (sawMatch) return [];
		const mostRecentVendor = window[window.length - 1]!;
		const vendorCandidate = findMatchingCandidate(mostRecentVendor, airCandidate);
		return [
			{
				detail: `Air shows ${airCandidate.votes.toLocaleString()} for ${airCandidate.name}; no vendor snapshot in lag window matched (vendor latest: ${vendorCandidate?.votes ?? 'n/a'})`,
				involves: { air: [airObservation], vendor: mostRecentVendor },
				observedAt: airObservation.observedAt,
				owner: 'us' as const,
				raceKey,
				severity: 'high' as const,
				type: 'votes_mismatch' as const,
			},
		];
	});
};

const checkPctIn = (
	raceKey: string,
	airObservation: RaceObservation,
	vendorHistory: RaceObservation[],
	thresholds: Thresholds,
): Anomaly[] => {
	const fromTime =
		airObservation.observedAt - thresholds.vendorToAirLagMaxMs - thresholds.lagSlackMs;
	const toTime = airObservation.observedAt - thresholds.vendorToAirLagMs + thresholds.lagSlackMs;
	const window = observationsInWindow(vendorHistory, fromTime, toTime);
	if (window.length === 0) return [];
	const sawMatch = window.some(
		(vendorObservation) =>
			Math.abs(vendorObservation.pctIn - airObservation.pctIn) <= thresholds.pctInTolerance,
	);
	if (sawMatch) return [];
	const mostRecentVendor = window[window.length - 1]!;
	return [
		{
			detail: `Air pct_in ${airObservation.pctIn} not within ${thresholds.pctInTolerance} of any vendor snapshot in lag window (vendor latest: ${mostRecentVendor.pctIn})`,
			involves: { air: [airObservation], vendor: mostRecentVendor },
			observedAt: airObservation.observedAt,
			owner: 'us',
			raceKey,
			severity: 'medium',
			type: 'pct_in_mismatch',
		},
	];
};

const sameMembers = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((value) => b.includes(value));

const lagWindowMs = (thresholds: Thresholds): number =>
	thresholds.providerToVendorLagMaxMs + thresholds.vendorToAirLagMaxMs;

// Call consistency, set-aware so top-2 races (provider calls two winners) work.
// Single-winner is just the one-element case, so the original rules are preserved.
const checkCallConsistency = (
	raceKey: string,
	airObservation: RaceObservation,
	providerHistory: RaceObservation[],
	thresholds: Thresholds,
): Anomaly[] => {
	const airCalled = airObservation.calledFor;

	if (airCalled.length === 0) {
		// Air shows no call — flag only if provider called someone long enough ago.
		const providerCalled = providerHistory.find((observation) => observation.calledFor.length > 0);
		if (providerCalled === undefined) return [];
		const elapsedSinceCall = airObservation.observedAt - providerCalled.observedAt;
		if (elapsedSinceCall > lagWindowMs(thresholds)) {
			return [
				{
					detail: `Provider called race for "${providerCalled.calledFor.join(', ')}" ${Math.round(elapsedSinceCall / 1000)}s ago; air still uncalled`,
					involves: { air: [airObservation], provider: providerCalled },
					observedAt: airObservation.observedAt,
					owner: 'us',
					raceKey,
					severity: 'high',
					type: 'missing_call',
				},
			];
		}
		return [];
	}

	// Air called someone. Exact agreement with any provider snapshot → fine.
	if (providerHistory.some((observation) => sameMembers(observation.calledFor, airCalled))) return [];

	const providerUnion = providerHistory.flatMap((observation) => observation.calledFor);
	const extra = airCalled.filter((key) => !providerUnion.includes(key));
	if (extra.length > 0) {
		// Air called someone the provider never called: premature (provider called
		// nobody) or a mismatch (provider called someone else).
		const anyProviderCall = providerHistory.find((observation) => observation.calledFor.length > 0);
		return [
			{
				detail:
					anyProviderCall === undefined
						? `Air called race for "${airCalled.join(', ')}" but provider has never called it`
						: `Air called race for "${airCalled.join(', ')}" but provider called it for "${anyProviderCall.calledFor.join(', ')}"`,
				involves:
					anyProviderCall === undefined
						? { air: [airObservation] }
						: { air: [airObservation], provider: anyProviderCall },
				observedAt: airObservation.observedAt,
				owner: 'us',
				raceKey,
				severity: 'high',
				type: anyProviderCall === undefined ? 'premature_call' : 'call_mismatch',
			},
		];
	}

	// Air's calls are all legitimate, but it may be MISSING a winner the provider
	// called (top-2 race where air only shows the leader) — flag after the lag window.
	const latestProviderCall = [...providerHistory]
		.reverse()
		.find((observation) => observation.calledFor.length > 0);
	if (latestProviderCall !== undefined) {
		const missing = latestProviderCall.calledFor.filter((key) => !airCalled.includes(key));
		const elapsedSinceCall = airObservation.observedAt - latestProviderCall.observedAt;
		if (missing.length > 0 && elapsedSinceCall > lagWindowMs(thresholds)) {
			return [
				{
					detail: `Provider called "${latestProviderCall.calledFor.join(', ')}" but air only shows "${airCalled.join(', ')}"`,
					involves: { air: [airObservation], provider: latestProviderCall },
					observedAt: airObservation.observedAt,
					owner: 'us',
					raceKey,
					severity: 'high',
					type: 'missing_call',
				},
			];
		}
	}
	return [];
};

const checkVoteDrop = (
	raceKey: string,
	history: RaceObservation[],
	source: SourceName,
	thresholds: Thresholds,
): Anomaly[] => {
	if (history.length < 2) return [];
	const previous = history[history.length - 2]!;
	const current = history[history.length - 1]!;
	return current.candidates.flatMap((currentCandidate) => {
		const previousCandidate = candidateBy(previous, currentCandidate.key);
		if (previousCandidate === undefined) return [];
		const drop = previousCandidate.votes - currentCandidate.votes;
		if (drop <= 0) return [];
		const dropFraction = drop / Math.max(previousCandidate.votes, 1);
		if (
			dropFraction < thresholds.voteDropPercentThreshold ||
			drop < thresholds.voteDropAbsoluteThreshold
		) {
			return [];
		}
		const involves: Anomaly['involves'] =
			source === 'air'
				? { air: [current] }
				: source === 'DDHQ'
					? { provider: current }
					: { vendor: current };
		return [
			{
				detail: `${currentCandidate.name} (${source}) dropped ${drop.toLocaleString()} votes (${(dropFraction * 100).toFixed(1)}%) from ${previousCandidate.votes.toLocaleString()} to ${currentCandidate.votes.toLocaleString()}`,
				involves,
				observedAt: current.observedAt,
				owner: 'observe' as const,
				raceKey,
				severity: 'medium' as const,
				type: 'vote_drop' as const,
			},
		];
	});
};

const checkCrossSurface = (
	raceKey: string,
	airHistory: RaceObservation[],
	now: number,
): Anomaly[] => {
	const concurrencyWindowMs = 2_000;
	const recent = airHistory.filter(
		(observation) => observation.observedAt >= now - concurrencyWindowMs,
	);
	if (recent.length < 2) return [];
	const byTemplate = new Map<string, RaceObservation>();
	recent.forEach((observation) => {
		if (observation.templateId === undefined) return;
		const existing = byTemplate.get(observation.templateId);
		if (existing === undefined || observation.observedAt > existing.observedAt) {
			byTemplate.set(observation.templateId, observation);
		}
	});
	const observations = Array.from(byTemplate.values());
	if (observations.length < 2) return [];
	const anomalies: Anomaly[] = [];
	observations.forEach((a, indexA) => {
		observations.slice(indexA + 1).forEach((b) => {
			a.candidates.forEach((aCandidate) => {
				const bCandidate = candidateByNormalizedName(b, aCandidate.name);
				if (bCandidate === undefined) return;
				if (aCandidate.votes !== bCandidate.votes) {
					anomalies.push({
						detail: `Two on-air surfaces disagree on ${aCandidate.name}: ${a.templateId}=${aCandidate.votes.toLocaleString()} vs ${b.templateId}=${bCandidate.votes.toLocaleString()}`,
						involves: { air: [a, b] },
						observedAt: Math.max(a.observedAt, b.observedAt),
						owner: 'us',
						raceKey,
						severity: 'high',
						type: 'cross_surface_mismatch',
					});
				}
			});
		});
	});
	return anomalies;
};

const reconcile = (input: ReconcileInput): Anomaly[] => {
	const { airHistory, now, providerHistory, raceKey, thresholds, vendorHistory } = input;
	const anomalies: Anomaly[] = [];

	const latestAir = latest(airHistory);
	const latestProvider = latest(providerHistory);
	const latestVendor = latest(vendorHistory);

	if (latestAir !== undefined && latestProvider !== undefined) {
		anomalies.push(
			...checkNameAgreement(raceKey, latestAir, latestProvider, 'DDHQ'),
			...checkAirBehindOrAhead(raceKey, latestAir, providerHistory, thresholds),
			...checkCallConsistency(raceKey, latestAir, providerHistory, thresholds),
		);
	}

	if (latestAir !== undefined && latestVendor !== undefined) {
		anomalies.push(
			...checkVotesMatchInLagWindow(raceKey, latestAir, vendorHistory, thresholds),
			...checkPctIn(raceKey, latestAir, vendorHistory, thresholds),
		);
	}

	if (latestProvider !== undefined) {
		anomalies.push(...checkVoteDrop(raceKey, providerHistory, 'DDHQ', thresholds));
	}
	if (latestVendor !== undefined) {
		anomalies.push(...checkVoteDrop(raceKey, vendorHistory, 'Ross', thresholds));
	}

	anomalies.push(...checkCrossSurface(raceKey, airHistory, now));

	return anomalies;
};

export {
	checkAirBehindOrAhead,
	checkCallConsistency,
	checkCrossSurface,
	checkNameAgreement,
	checkPctIn,
	checkVoteDrop,
	checkVotesMatchInLagWindow,
	findNearest,
	normalizeName,
	observationsInWindow,
};

export default reconcile;
