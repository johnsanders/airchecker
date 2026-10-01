import { describe, expect, it } from 'vitest';

import { AIR_LAG_MS, CHAMELEON_LAG_MS, makeNight } from '../src/air/night.js';
import { chameleonPlaylist, ddhqResponse, nightQueries } from '../src/air/nightMirror.js';
import { loadRaces } from '../src/air/races.js';
import { onAirAt } from '../src/air/schedule.js';

const races = loadRaces('races.json');
const night = makeNight(races, 11, 30 * 60_000);
const NOW = Date.UTC(2026, 10, 3, 23, 0);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 40].map((minute) => minute * 60_000);

const allDdhq = (elapsedMs: number) =>
	nightQueries(night).flatMap((query) => ddhqResponse(night, elapsedMs, NOW, query).data);

// The checker's race key (composeRaceKey in its sources/common.ts) from each source's fields.
const ddhqKey = (race: ReturnType<typeof allDdhq>[number]) =>
	[race.year, race.state, race.office, race.district ?? '', race.name].join('|');

type Contest = ReturnType<typeof chameleonPlaylist>['ElectionPlaylist']['contest'][number];
const chameleonKey = (contest: Contest) =>
	[
		2026,
		contest.area.nameShort.split(' - ')[0],
		contest.officename,
		contest.area.District,
		contest.contestType,
	].join('|');

describe('ddhqResponse', () => {
	it('answers a race_ids query with just those races, on one page', () => {
		const ids = races.slice(0, 3).map((race) => race.ddhq.raceId);
		const response = ddhqResponse(night, 0, NOW, `race_ids=${ids.join(',')}`);
		expect(response.data.map((race) => race.race_id)).toEqual(ids);
		expect(response).toMatchObject({ next_page_url: null, page: 1, total: 3, total_pages: 1 });
	});

	it('covers every race of the night across its queries', () =>
		expect(new Set(allDdhq(0).map((race) => race.race_id)).size).toBe(races.length));

	it('has the fields the checker parses', () => {
		const race = allDdhq(20 * 60_000)[0];
		expect(race).toMatchObject({
			candidates: expect.arrayContaining([
				expect.objectContaining({
					cand_id: expect.any(Number),
					incumbent: expect.any(Boolean),
					last_name: expect.any(String),
					party_id: expect.any(Number),
					party_name: expect.any(String),
				}),
			]),
			last_updated: expect.any(String),
			level: expect.any(String),
			race_id: expect.any(Number),
			reporting_type: 'estimated',
			topline_results: {
				call_times: [],
				called_candidates: expect.any(Array),
				estimated_votes: { turnout_mid: expect.any(Number) },
				precincts: { reporting: 0, total: 0 },
				total_votes: expect.any(Number),
			},
			year: 2026,
		});
	});
});

describe('the sources agree', () => {
	it('gives DDHQ and Chameleon the same race keys', () => {
		const contests = chameleonPlaylist(night, 0, NOW).ElectionPlaylist.contest;
		expect(contests.map(chameleonKey).sort()).toEqual(allDdhq(0).map(ddhqKey).sort());
	});

	it('has Chameleon show what DDHQ showed CHAMELEON_LAG_MS earlier', () =>
		MINUTES.forEach((elapsedMs) => {
			const ddhqById = new Map(allDdhq(elapsedMs).map((race) => [race.race_id, race]));
			chameleonPlaylist(night, elapsedMs + CHAMELEON_LAG_MS, NOW).ElectionPlaylist.contest.forEach(
				(contest) => {
					const ddhq = ddhqById.get(contest.id);
					expect(Number(contest.dbVotesPercent)).toBe(
						ddhq?.topline_results.estimated_votes.turnout_mid,
					);
					contest.choice.forEach((choice) => {
						expect(choice.votes.total).toBe(ddhq?.topline_results.votes[String(choice.id)]);
						expect(choice.elected).toBe(
							ddhq?.topline_results.called_candidates.includes(choice.id) ?? false,
						);
					});
				},
			);
		}));

	it('has the graphics show what Chameleon showed, AIR_LAG_MS − CHAMELEON_LAG_MS earlier', () =>
		MINUTES.forEach((elapsedMs) => {
			const onAir = onAirAt(night, elapsedMs + AIR_LAG_MS);
			// Down until the first race has votes on air.
			if (onAir.ticker === null) return;
			const ticker = onAir.ticker;
			const contest = chameleonPlaylist(
				night,
				elapsedMs + CHAMELEON_LAG_MS,
				NOW,
			).ElectionPlaylist.contest.find(
				(candidate) =>
					races.find((race) => race.key === ticker.raceKey)?.ddhq.raceId === candidate.id,
			);
			const shown = [ticker.data.cand1, ticker.data.cand2];
			shown.forEach((graphicCandidate) => {
				const choice = contest?.choice.find(
					(candidate) => `${candidate.firstName}|${candidate.lastName}` === graphicCandidate.name,
				);
				expect(choice?.votes.total).toBe(graphicCandidate.votes);
				expect(choice?.elected).toBe(graphicCandidate.isWinner);
			});
		}));
});
