import { z } from 'zod';

import type { ApiRecording } from '../recording/apiRecording.js';
import type { CandidateResult, RacePlan, RaceResult } from './night.js';
import type { RaceCandidate } from './races.js';

// A night's numbers read from an API recording, for putting a recorded night on the
// simulated air. The graphics are built from Chameleon, so this reads the recorded
// Chameleon playlists: a race's result at a moment is its contest in the last playlist
// recorded at or before it. Contests name their DDHQ race in raceID; their choices carry
// Chameleon's own ids, so candidates are matched to races.json's by name.

const PLAYLIST_ROUTE = '/chameleon/blade/election/playlist/';

const choiceSchema = z.object({
	elected: z.boolean(),
	firstName: z.string().nullable(),
	lastName: z.string().nullable(),
	votes: z.object({ total: z.number(), votePercent: z.number() }),
});

const contestSchema = z.object({
	choice: z.array(choiceSchema),
	dbVotesPercent: z.coerce.number(),
	raceID: z.coerce.number().nullable().optional(),
});

const playlistSchema = z.object({
	ElectionPlaylist: z.object({ contest: z.array(contestSchema) }),
});

export type RecordedResults = {
	raceIds: Set<number>; // every DDHQ race any recorded playlist carries
	resultAt: (plan: RacePlan, recordingTs: number) => RaceResult;
};

type Choice = z.infer<typeof choiceSchema>;

type Contest = z.infer<typeof contestSchema>;

type Snapshot = { contests: Map<number, Contest>; ts: number };

const normalize = (name: null | string): string =>
	(name ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[^a-z]/g, '');

// By surname, then first name when two on the ballot share one.
const choiceFor = (choices: Choice[], candidate: RaceCandidate): Choice | undefined => {
	const sameLast = choices.filter(
		(choice) => normalize(choice.lastName) === normalize(candidate.last),
	);
	return sameLast.length <= 1
		? sameLast[0]
		: sameLast.find((choice) => normalize(choice.firstName) === normalize(candidate.first));
};

export const makeRecordedResults = (recording: ApiRecording): RecordedResults => {
	const snapshots: Snapshot[] = recording.responses
		.filter(
			(row) => row.source === 'Ross' && row.error === null && row.path.startsWith(PLAYLIST_ROUTE),
		)
		.flatMap((row) => {
			const parsed = playlistSchema.safeParse(row.body);
			if (!parsed.success) return [];
			const contests = parsed.data.ElectionPlaylist.contest.flatMap((contest) =>
				contest.raceID === null || contest.raceID === undefined
					? []
					: [[contest.raceID, contest] as const],
			);
			return [{ contests: new Map(contests), ts: row.ts }];
		});

	const resultAt = (plan: RacePlan, recordingTs: number): RaceResult => {
		// Before the first poll, the first poll: the night was already underway when the
		// recording began, and zeros would read as the graphics being wrong.
		const snapshot =
			snapshots.filter((candidate) => candidate.ts <= recordingTs).at(-1) ?? snapshots[0];
		const contest = snapshot?.contests.get(plan.race.ddhq.raceId);
		const choices = contest?.choice ?? [];
		const candidates: CandidateResult[] = plan.race.candidates.map((candidate) => {
			const choice = choiceFor(choices, candidate);
			return {
				candidate,
				isWinner: choice?.elected ?? false,
				votePercent: choice?.votes.votePercent ?? 0,
				votes: choice?.votes.total ?? 0,
			};
		});
		const resultFor = (candidate: RaceCandidate) =>
			candidates.find((result) => result.candidate === candidate) as CandidateResult;
		return {
			called: choices.some((choice) => choice.elected),
			candidates,
			left: resultFor(plan.left),
			pctIn: Math.floor(contest?.dbVotesPercent ?? 0),
			right: resultFor(plan.right),
			totalVotes: choices.reduce((sum, choice) => sum + choice.votes.total, 0),
		};
	};

	return {
		raceIds: new Set(snapshots.flatMap((snapshot) => Array.from(snapshot.contests.keys()))),
		resultAt,
	};
};
