import type { RaceObservation } from '../reconcile/reconcile.js';

// Sources append a fresh observation on every poll/capture even when the upstream
// numbers haven't moved (and the air capturer emits an empty batch when no graphic
// is on screen). We only want to nudge web clients when something they render
// actually changed: pctIn, the candidate rows (votes/pct/party/name), and the called
// set. Candidates are sorted by key and calledFor sorted so a stable-data reorder
// doesn't read as a change.
const renderSignature = (observation: RaceObservation): string =>
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

// True when `next` differs from the prior latest observation for the same source +
// race in the fields the web view renders. A first-ever observation (no previous) is
// always a change.
export const observationChanged = (
	previous: RaceObservation | undefined,
	next: RaceObservation,
): boolean => previous === undefined || renderSignature(previous) !== renderSignature(next);
