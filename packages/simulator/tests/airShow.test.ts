import { describe, expect, it } from 'vitest';

import type { LiveResultsSource } from '../src/air/liveResults.js';
import type { ApiRecording } from '../src/recording/apiRecording.js';
import type { AirSource } from '../src/settings.js';

import { makeAirShow } from '../src/air/airShow.js';
import { loadRaces } from '../src/air/races.js';
import { makePlaybackClock } from '../src/playback/playbackClock.js';

// The mode switch is the new, risky part of airShow: which resolver a run uses (raceAt
// vs the live cache), and when liveResults itself is started and stopped. Everything
// else here (schedule, mirror shapes, lag) is already covered by schedule.test.ts and
// nightMirror.test.ts, exercised through onAirAt/ddhqResponse/chameleonPlaylist directly.

const races = loadRaces('races.json');
const raceId = races[0]!.ddhq.raceId;

const makeFakeLiveResults = (): {
	calls: string[];
	live: LiveResultsSource;
	setVotes: (v: number) => void;
} => {
	const calls: string[] = [];
	let votes = 0;
	return {
		calls,
		live: {
			errors: () => [],
			getResult: (id) =>
				id === raceId
					? {
							race_id: id,
							reporting_type: 'estimated',
							topline_results: {
								called_candidates: [],
								estimated_votes: { turnout_mid: 7 },
								precincts: { percent: null },
								total_votes: votes,
								votes: {},
							},
						}
					: undefined,
			start: () => calls.push('start'),
			stop: () => calls.push('stop'),
			tickOnce: async () => {},
		},
		setVotes: (next) => {
			votes = next;
		},
	};
};

const ddhqVotesFor = (mirror: ReturnType<typeof makeAirShow>['mirror']) => {
	const answer = mirror('DDHQ', `/api/v4/races?race_ids=${raceId}`);
	return answer?.kind === 'ok'
		? (answer.body as { data: { topline_results: { total_votes: number } }[] }).data[0]
				?.topline_results.total_votes
		: undefined;
};

describe('makeAirShow airSource', () => {
	it('serves the live cache instead of the invented night when set to ddhqIntegration', () => {
		const fake = makeFakeLiveResults();
		fake.setVotes(4_242);
		const airShow = makeAirShow({
			getAirSource: () => 'ddhqIntegration',
			liveResults: fake.live,
			races,
		});

		airShow.start(30 * 60_000);

		expect(ddhqVotesFor(airShow.mirror)).toBe(4_242);
		expect(fake.calls).toEqual(['start']);
	});

	it('starts and stops liveResults only on the transition, not on a same-mode restart', () => {
		const fake = makeFakeLiveResults();
		let airSource: AirSource = 'ddhqIntegration';
		const airShow = makeAirShow({ getAirSource: () => airSource, liveResults: fake.live, races });

		airShow.start(30 * 60_000); // off -> live
		airShow.start(30 * 60_000); // live -> live (a "New night"): no restart of the poll loop
		expect(fake.calls).toEqual(['start']);

		airSource = 'invented';
		airShow.start(30 * 60_000); // live -> invented
		expect(fake.calls).toEqual(['start', 'stop']);

		airSource = 'ddhqIntegration';
		airShow.start(30 * 60_000); // invented -> live
		expect(fake.calls).toEqual(['start', 'stop', 'start']);

		airShow.stop(); // live -> off
		expect(fake.calls).toEqual(['start', 'stop', 'start', 'stop']);
	});

	it('never touches liveResults when the mode is invented (the default)', () => {
		const fake = makeFakeLiveResults();
		const airShow = makeAirShow({ liveResults: fake.live, races });

		airShow.start(30 * 60_000);
		airShow.stop();

		expect(fake.calls).toEqual([]);
	});

	it('falls back to invented when airSource is live but no liveResults source is wired', () => {
		const airShow = makeAirShow({ getAirSource: () => 'ddhqIntegration', races });
		airShow.start(30 * 60_000);
		// No liveResults means no live cache to read — the invented night's numbers show
		// instead, not liveResultFor's "not yet reporting" zeros for every race.
		expect(ddhqVotesFor(airShow.mirror)).toEqual(expect.any(Number));
	});

	it('surfaces liveResults errors through liveResultErrors', () => {
		const fake = makeFakeLiveResults();
		fake.live.errors = () => ['DDHQ: boom'];
		const airShow = makeAirShow({
			getAirSource: () => 'ddhqIntegration',
			liveResults: fake.live,
			races,
		});
		expect(airShow.liveResultErrors()).toEqual(['DDHQ: boom']);
	});
});

// A recording of two Chameleon polls a minute apart, carrying races[0] (Moore R, Wess D)
// under Chameleon's own choice ids, plus a contest that isn't on the take list.
const PLAYLIST_PATH = '/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json';

const playlist = (mooreVotes: number, wessVotes: number, elected: boolean) => ({
	ElectionPlaylist: {
		contest: [
			{
				choice: [
					{
						elected,
						firstName: 'Barry',
						id: 1,
						lastName: 'Moore',
						votes: { total: mooreVotes, votePercent: 60 },
					},
					{
						elected: false,
						firstName: 'Everett',
						id: 2,
						lastName: 'Wess',
						votes: { total: wessVotes, votePercent: 40 },
					},
				],
				dbVotesPercent: '42.7',
				raceID: String(raceId),
			},
			{ choice: [], dbVotesPercent: '0', raceID: '1' },
		],
	},
});

const makeRecording = (contests = true): ApiRecording => ({
	meta: { ddhqQueries: ['race_ids=1'], name: 'nov3', startedAt: 0, stoppedAt: 120_000 },
	responses: [
		{ body: () => null, error: null, path: '/api/v4/races?race_ids=1', source: 'DDHQ', ts: 0 },
		{
			body: () => (contests ? playlist(600, 400, false) : { ElectionPlaylist: { contest: [] } }),
			error: null,
			path: PLAYLIST_PATH,
			source: 'Ross',
			ts: 0,
		},
		{
			body: () => (contests ? playlist(900, 600, true) : { ElectionPlaylist: { contest: [] } }),
			error: null,
			path: PLAYLIST_PATH,
			source: 'Ross',
			ts: 60_000,
		},
		{
			body: () => null,
			error: null,
			path: '/api/v4/races?race_ids=1',
			source: 'DDHQ',
			ts: 120_000,
		},
	],
});

const GRAPHICS_LAG_MS = 19_000;

describe('makeAirShow feed (an API recording on air)', () => {
	const setup = (recording = makeRecording()) => {
		let wall = 1_000_000;
		const airShow = makeAirShow({ now: () => wall, races, randomSeed: () => 7 });
		const clock = makePlaybackClock(recording, () => wall);
		airShow.feed.start({ clock, recording });
		const ticker = () => airShow.onAir()?.ticker.data;
		return {
			airShow,
			clock,
			setWall: (next: number) => {
				wall = next;
			},
			ticker,
			wall: () => wall,
		};
	};

	it('airs the take-list races the recording carries, with the recorded numbers', () => {
		const { airShow, setWall, ticker } = setup();
		expect(airShow.status()).toMatchObject({ races: 1, recording: 'nov3' });
		expect(airShow.onAir()?.ticker.raceKey).toBe(races[0]!.key);
		// Wess is the Democrat, so he's on the left.
		expect(ticker()).toMatchObject({
			cand1: { name: 'Everett|Wess', votes: 400 },
			cand2: { isWinner: false, name: 'Barry|Moore', votes: 600 },
			pctIn: '42',
		});
		// The second poll lands on air GRAPHICS_LAG_MS after it was recorded.
		setWall(1_000_000 + 60_000 + GRAPHICS_LAG_MS - 1);
		expect(ticker()?.cand2.votes).toBe(600);
		setWall(1_000_000 + 60_000 + GRAPHICS_LAG_MS);
		expect(ticker()?.cand2).toMatchObject({ isWinner: true, votes: 900 });
	});

	it('leaves the mirrors and the query list to the playback', () => {
		const { airShow } = setup();
		expect(airShow.mirror('Ross', PLAYLIST_PATH)).toBeUndefined();
		expect(airShow.queries()).toBeUndefined();
	});

	it('holds the numbers while paused, and follows the recording again on resume', () => {
		const { airShow, clock, setWall, ticker, wall } = setup();
		setWall(wall() + 30_000);
		clock.pause();
		airShow.feed.pause();
		setWall(wall() + 600_000);
		expect(ticker()?.cand2.votes).toBe(600);
		clock.resume();
		airShow.feed.resume();
		setWall(wall() + 60_000);
		expect(ticker()?.cand2.votes).toBe(900);
	});

	it('ends with its playback, not with the night controls', () => {
		const { airShow } = setup();
		airShow.stop();
		expect(airShow.onAir()).not.toBeNull();
		airShow.feed.stop();
		expect(airShow.onAir()).toBeNull();
		expect(airShow.status()).toBeNull();
	});

	it('airs nothing when the recording carries no take-list race', () => {
		const { airShow } = setup(makeRecording(false));
		expect(airShow.onAir()).toBeNull();
	});
});
