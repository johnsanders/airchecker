import { describe, expect, it } from 'vitest';

import type { LiveResultsSource } from '../src/air/liveResults.js';
import type { AirSource } from '../src/settings.js';

import { makeAirShow } from '../src/air/airShow.js';
import { loadRaces } from '../src/air/races.js';

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
