import type { RaceObservation } from '../reconcile/reconcile.js';

// What an observation says: pctIn, the candidate rows (votes/pct/party/name) and the
// called set. Candidates are sorted by key and calledFor sorted, so the same figures in
// another order say the same thing.
const signature = (observation: RaceObservation): string =>
	JSON.stringify({
		calledFor: [...observation.calledFor].sort(),
		candidates: [...observation.candidates]
			.sort((a, b) => a.key.localeCompare(b.key))
			.map((candidate) => [
				candidate.key,
				candidate.name,
				candidate.party,
				candidate.votes,
				candidate.pct,
			]),
		pctIn: observation.pctIn,
	});

// True when `next` says something the source's previous observation of the race didn't.
// A first observation always does.
export const observationChanged = (
	previous: RaceObservation | undefined,
	next: RaceObservation,
): boolean => previous === undefined || signature(previous) !== signature(next);
