import type { CandidateState, RaceObservation } from '../../reconcile/reconcile.js';
import type { ChameleonChoice, ChameleonContest, ChameleonResponse } from './chameleonSchema.js';

import { composeRaceKey, partyLetter } from '../common.js';

const yearFromIsoDate = (iso: string): number => {
	const parsed = new Date(iso);
	return Number.isNaN(parsed.getTime()) ? 0 : parsed.getUTCFullYear();
};

const extractStateCode = (nameShort: string): string =>
	(nameShort.split(' - ')[0] ?? nameShort).trim();

const buildContestRaceKey = (contest: ChameleonContest): string =>
	composeRaceKey({
		contestType: contest.contestType,
		district: contest.area.District ?? null,
		office: contest.officename,
		party: contest.party,
		state: extractStateCode(contest.area.nameShort),
		year: yearFromIsoDate(contest.event.date),
	});

const buildCandidateName = (choice: ChameleonChoice): string => {
	const first = choice.firstName ?? '';
	const last = choice.lastName ?? '';
	const composed = [first, last].filter((part) => part.length > 0).join(' ');
	if (composed.length > 0) return composed;
	return choice.name2 ?? choice.name;
};

const adaptContest = (
	contest: ChameleonContest,
	observedAt: number,
	fallbackReportedAt: number,
): RaceObservation => {
	const raceKey = buildContestRaceKey(contest);
	const candidates: CandidateState[] = contest.choice.map((choice) => ({
		key: String(choice.id),
		name: buildCandidateName(choice),
		party: choice.party === null ? 'I' : partyLetter(choice.party.name),
		pct: choice.votes.votePercent,
		votes: choice.votes.total,
	}));
	const calledFor = contest.choice
		.filter((choice) => choice.elected)
		.map((choice) => String(choice.id));
	const reportedRaw = parseFloat(contest.polls.reportedPercent);
	const modifiedParsed = Date.parse(contest.modifiedDate);
	return {
		calledFor,
		candidates,
		observedAt,
		pctIn: Number.isNaN(reportedRaw) ? 0 : reportedRaw,
		raceKey,
		reportedAt: Number.isNaN(modifiedParsed) ? fallbackReportedAt : modifiedParsed,
		source: 'Ross',
	};
};

const adaptResponse = (response: ChameleonResponse, observedAt: number): RaceObservation[] => {
	const generatedAt = Date.parse(response.generated);
	const fallback = Number.isNaN(generatedAt) ? observedAt : generatedAt;
	return response.ElectionPlaylist.contest.map((contest) =>
		adaptContest(contest, observedAt, fallback),
	);
};

export {
	adaptContest,
	adaptResponse,
	buildCandidateName,
	buildContestRaceKey,
	extractStateCode,
	yearFromIsoDate,
};
