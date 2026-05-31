import type { CandidateState, RaceObservation } from '../../reconcile/reconcile.js';
import type { DdhqCandidate, DdhqRace, DdhqResponse } from './ddhqSchema.js';

import { composeRaceKey, partyLetter } from '../common.js';

const buildRaceKey = (race: DdhqRace): string =>
	composeRaceKey({
		contestType: race.name,
		district: race.district,
		office: race.office,
		party: race.party,
		state: race.state,
		year: race.year,
	});

const nonEmpty = (value: null | string | undefined): string =>
	value === null || value === undefined ? '' : value;

const buildCandidateName = (candidate: DdhqCandidate): string => {
	const preferred = nonEmpty(candidate.preferred_name);
	const first = preferred.length > 0 ? preferred : nonEmpty(candidate.first_name);
	const parts = [
		first,
		nonEmpty(candidate.middle_name),
		candidate.last_name,
		nonEmpty(candidate.suffix),
	];
	return parts.filter((part) => part.length > 0).join(' ');
};

const adaptRace = (race: DdhqRace, observedAt: number): RaceObservation => {
	const raceKey = buildRaceKey(race);
	const totalVotes = race.topline_results.total_votes;
	const candidates: CandidateState[] = race.candidates.map((candidate) => {
		const candIdStr = String(candidate.cand_id);
		const votes = race.topline_results.votes[candIdStr] ?? 0;
		return {
			key: candIdStr,
			name: buildCandidateName(candidate),
			party: partyLetter(candidate.party_name),
			pct: totalVotes === 0 ? 0 : (votes / totalVotes) * 100,
			votes,
		};
	});
	const calledFor = race.topline_results.called_candidates.map(String);
	const reportedAt = Date.parse(race.last_updated);
	return {
		calledFor,
		candidates,
		observedAt,
		pctIn: race.topline_results.precincts.percent,
		raceKey,
		reportedAt: Number.isNaN(reportedAt) ? null : reportedAt,
		source: 'DDHQ',
	};
};

const adaptResponse = (response: DdhqResponse, observedAt: number): RaceObservation[] =>
	response.data.map((race) => adaptRace(race, observedAt));

export { adaptRace, adaptResponse, buildCandidateName, buildRaceKey };
export { partyLetter } from '../common.js';
