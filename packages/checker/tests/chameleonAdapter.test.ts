import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { adaptRace as adaptDdhqRace } from '../src/sources/provider/adapter.js';
import { ddhqResponseSchema } from '../src/sources/provider/ddhqSchema.js';
import {
	adaptContest,
	adaptResponse,
	buildCandidateName,
	buildContestRaceKey,
	yearFromIsoDate,
} from '../src/sources/vendor/adapter.js';
import { chameleonResponseSchema } from '../src/sources/vendor/chameleonSchema.js';

const here = dirname(fileURLToPath(import.meta.url));
const chameleonPath = resolve(here, '..', 'chameleon_response_example.json');
const chameleonJson = JSON.parse(readFileSync(chameleonPath, 'utf8')) as unknown;

describe('Chameleon schema', () => {
	it('parses the full example response (49 contests) without errors', () => {
		const parsed = chameleonResponseSchema.safeParse(chameleonJson);
		if (!parsed.success) {
			// Surface the first error so the test failure is actionable
			throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3), null, 2));
		}
		expect(parsed.data.ElectionPlaylist.contest.length).toBeGreaterThan(0);
	});
});

describe('yearFromIsoDate', () => {
	it('extracts the year from an ISO-like date string', () => {
		expect(yearFromIsoDate('2026-05-26T00:00:00')).toBe(2026);
	});
});

describe('buildContestRaceKey', () => {
	it('produces a key composed from the same political dimensions as DDHQ', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const tx18 = response.ElectionPlaylist.contest.find(
			(c) =>
				c.officename === 'US House' &&
				c.area.District === '18' &&
				c.party === 'Democratic' &&
				c.contestType === 'Runoff',
		);
		expect(tx18).toBeDefined();
		expect(buildContestRaceKey(tx18!)).toBe('2026-TX-US_House-18-Democratic-Runoff');
	});

	it('falls back to AL when District is the empty string', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const senateRunoff = response.ElectionPlaylist.contest.find(
			(c) => c.officename === 'US Senate' && c.contestType === 'Runoff',
		);
		expect(senateRunoff).toBeDefined();
		expect(buildContestRaceKey(senateRunoff!)).toContain('-AL-');
	});
});

describe('buildCandidateName', () => {
	it('prefers firstName + lastName when present', () => {
		const choice = {
			elected: false,
			firstName: 'John',
			id: 1,
			incumbent: true,
			lastName: 'Cornyn',
			name: 'Cornyn, John',
			name2: 'John Cornyn',
			party: { name: 'Republican', nameShort: 'GOP' },
			votes: { total: 0, votePercent: 0 },
		};
		expect(buildCandidateName(choice)).toBe('John Cornyn');
	});

	it('falls back to name2 when first/last are absent', () => {
		const choice = {
			elected: false,
			firstName: null,
			id: 1,
			incumbent: true,
			lastName: null,
			name: 'Cornyn, John',
			name2: 'John Cornyn',
			party: null,
			votes: { total: 0, votePercent: 0 },
		};
		expect(buildCandidateName(choice)).toBe('John Cornyn');
	});
});

describe('adaptContest', () => {
	it('produces a vendor RaceObservation for the TX-18 House Democratic Runoff', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const tx18 = response.ElectionPlaylist.contest.find(
			(c) =>
				c.officename === 'US House' &&
				c.area.District === '18' &&
				c.party === 'Democratic' &&
				c.contestType === 'Runoff',
		)!;
		const observed = adaptContest(tx18, 1_700_000_000_000, 1_700_000_000_000);
		expect(observed.source).toBe('Ross');
		expect(observed.raceKey).toBe('2026-TX-US_House-18-Democratic-Runoff');
		expect(observed.pctIn).toBeGreaterThanOrEqual(0);
		expect(observed.candidates).toHaveLength(2);
		expect(observed.candidates.every((c) => c.party === 'D')).toBe(true);
	});

	it('sets calledFor to every elected candidate id', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const senateRunoff = response.ElectionPlaylist.contest.find(
			(c) => c.officename === 'US Senate' && c.contestType === 'Runoff',
		)!;
		const observed = adaptContest(senateRunoff, 1_700_000_000_000, 1_700_000_000_000);
		const elected = senateRunoff.choice.filter((c) => c.elected).map((c) => String(c.id));
		expect(observed.calledFor).toEqual(elected);
	});
});

describe('adaptResponse', () => {
	it('produces one observation per contest', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const observations = adaptResponse(response, 1_700_000_000_000);
		expect(observations).toHaveLength(response.ElectionPlaylist.contest.length);
		expect(observations.every((o) => o.source === 'Ross')).toBe(true);
	});
});

// Cross-source race key alignment is the load-bearing invariant: both adapters
// must produce the same raceKey for the same race. We can't always pull one from
// the real samples (different election dates, different states), so this
// validates the invariant against a synthetic pair that exercises both schemas
// and both adapters end-to-end.
describe('cross-source race key alignment', () => {
	it('produces the same raceKey for matching political dimensions in DDHQ and Chameleon', () => {
		const ddhqRace = ddhqResponseSchema.parse({
			data: [
				{
					candidates: [
						{
							cand_id: 1,
							first_name: 'Test',
							incumbent: false,
							last_name: 'Candidate',
							middle_name: null,
							party_id: 1,
							party_name: 'Democratic',
							preferred_name: null,
							suffix: null,
						},
					],
					district: '18',
					election_type_id: 4,
					last_updated: '2026-05-26T20:00:00.000Z',
					level: 'Federal/District',
					name: 'Runoff',
					office: 'US House',
					office_id: 3,
					party: 'Democratic',
					party_id: 1,
					poll_close_time: '2026-05-26T20:00:00.000Z',
					poll_close_time_utc: '2026-05-27T01:00:00.000Z',
					race_created: '2026-01-01T00:00:00.000Z',
					race_date: '2026-05-26',
					race_id: 1,
					state: 'TX',
					state_fips: '48',
					state_name: 'Texas',
					test_data: false,
					topline_results: {
						advance_times: [],
						advancing_candidates: [],
						call_times: [],
						called_candidates: [],
						precincts: { percent: 0, reporting: 0, total: 100 },
						total_votes: 100,
						votes: { '1': 100 },
					},
					year: 2026,
				},
			],
			limit: 10,
			next_page_url: '',
			page: 1,
			total: 1,
			total_pages: 1,
		}).data[0]!;

		const chameleonContest = chameleonResponseSchema.parse({
			ElectionPlaylist: {
				contest: [
					{
						area: {
							District: '18',
							id: 1,
							name: 'Texas',
							nameShort: 'TX - 18',
							State: 'TX',
						},
						choice: [
							{
								elected: false,
								firstName: 'Test',
								id: 1,
								incumbent: false,
								lastName: 'Candidate',
								name: 'Candidate, Test',
								name2: 'Test Candidate',
								party: { name: 'Democratic', nameShort: 'DEM' },
								votes: { total: 100, votePercent: 100 },
							},
						],
						contestType: 'Runoff',
						dbVotesPercent: '0',
						event: { date: '2026-05-26T00:00:00', id: 1, name: 'TX Runoffs', type: 'Runoff' },
						id: 1,
						modifiedDate: '2026-05-26T20:00:00',
						office: { id: 3, name: 'US House' },
						officename: 'US House',
						party: 'Democratic',
						polls: {
							closingTime: '2026-05-26T20:00:00',
							isClosed: false,
							reported: 0,
							reportedPercent: '0',
							total: 100,
						},
					},
				],
				id: 1,
				name: 'TX Runoffs',
			},
			generated: '2026-05-26T20:00:00',
		}).ElectionPlaylist.contest[0]!;

		const providerObservation = adaptDdhqRace(ddhqRace, 0);
		const vendorObservation = adaptContest(chameleonContest, 0, 0);
		expect(providerObservation.raceKey).toBe('2026-TX-US_House-18-Democratic-Runoff');
		expect(vendorObservation.raceKey).toBe(providerObservation.raceKey);
	});
});

// The September 2026 General playlist slice: area.State/District/County are
// dynamic fields that are usually absent; lowercase state/district carry the data.
const chameleonGeneralPath = resolve(here, '..', 'chameleon_response_general_example.json');
const chameleonGeneralJson = JSON.parse(readFileSync(chameleonGeneralPath, 'utf8')) as unknown;
const ddhqGeneralPath = resolve(here, '..', 'ddhq_response_general_example.json');
const ddhqGeneralJson = JSON.parse(readFileSync(ddhqGeneralPath, 'utf8')) as unknown;

describe('Chameleon General Election sample', () => {
	it('parses every area shape on the General playlist without errors', () => {
		const parsed = chameleonResponseSchema.safeParse(chameleonGeneralJson);
		if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
		expect(parsed.data.ElectionPlaylist.contest).toHaveLength(13);
	});

	it('takes the district from the lowercase area.district when District is absent', () => {
		const response = chameleonResponseSchema.parse(chameleonGeneralJson);
		const tx9 = response.ElectionPlaylist.contest.find((contest) => contest.id === 90203);
		expect(tx9?.area.District).toBeUndefined();
		expect(tx9 && buildContestRaceKey(tx9)).toBe('2026-TX-US_House-9-NP-General_Election');
	});

	it('still honours area.District when only the dynamic field is set', () => {
		const response = chameleonResponseSchema.parse(chameleonGeneralJson);
		const az1 = response.ElectionPlaylist.contest.find((contest) => contest.id === 89847);
		expect(az1?.area.district).toBeUndefined();
		expect(az1 && buildContestRaceKey(az1)).toBe('2026-AZ-US_House-1-NP-General_Election');
	});

	it('keys a statewide General race as at-large when both district fields are blank', () => {
		const response = chameleonResponseSchema.parse(chameleonGeneralJson);
		const ks = response.ElectionPlaylist.contest.find((contest) => contest.id === 90362);
		expect(ks && buildContestRaceKey(ks)).toBe('2026-KS-US_Senate-AL-NP-General_Election');
	});
});

describe('cross-source race key alignment on the real General samples', () => {
	it('gives DDHQ race 295078 and the Chameleon contest carrying raceID 295078 the same key', () => {
		const ddhq = ddhqResponseSchema.parse(ddhqGeneralJson);
		const chameleon = chameleonResponseSchema.parse(chameleonGeneralJson);
		const ddhqRace = ddhq.data.find((race) => race.race_id === 295078);
		const contest = chameleon.ElectionPlaylist.contest.find((c) => c.id === 90203);
		expect(ddhqRace && contest).toBeTruthy();
		const provider = adaptDdhqRace(ddhqRace!, 1_000);
		const vendor = adaptContest(contest!, 1_000, 1_000);
		expect(vendor.raceKey).toBe(provider.raceKey);
		expect(provider.raceKey).toBe('2026-TX-US_House-9-NP-General_Election');
	});

	it('carries the DDHQ race_id on both observations', () => {
		const ddhq = ddhqResponseSchema.parse(ddhqGeneralJson);
		const chameleon = chameleonResponseSchema.parse(chameleonGeneralJson);
		const ddhqRace = ddhq.data.find((race) => race.race_id === 295078);
		const contest = chameleon.ElectionPlaylist.contest.find((c) => c.id === 90203);
		expect(adaptDdhqRace(ddhqRace!, 1_000).providerRaceId).toBe('295078');
		expect(adaptContest(contest!, 1_000, 1_000).providerRaceId).toBe('295078');
	});

	it('leaves providerRaceId off contests from playlists without raceID', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const observations = adaptResponse(response, 1_000);
		expect(observations.every((observation) => !('providerRaceId' in observation))).toBe(true);
	});
});

describe('pctIn comes from dbVotesPercent', () => {
	it('reads the turnout-based dbVotesPercent, not the precinct-based polls.reportedPercent', () => {
		const response = chameleonResponseSchema.parse(chameleonJson);
		const contest = response.ElectionPlaylist.contest.find(
			(candidate) => candidate.polls.reportedPercent === '100' && candidate.dbVotesPercent === '95',
		);
		expect(contest).toBeDefined();
		expect(adaptContest(contest!, 0, 0).pctIn).toBe(95);
	});
});
