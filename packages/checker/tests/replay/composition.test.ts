import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';

import makePlayer from '../../src/replay/player.js';
import makeRecorder from '../../src/replay/recorder.js';
import makeComposition from '../../src/runtime/composition.js';

const RACE = '2026-TX-US_Senate-AL-NP-General_Election';
const HEADING = 'TX U.S. SENATE';

const observation = (
	source: SourceName,
	at: number,
	votes: number,
	options: { called?: boolean; raceKey?: string; templateId?: string } = {},
): RaceObservation => {
	const keys = source === 'air' ? ['Jane Smith', 'John Doe'] : ['A', 'B'];
	return {
		calledFor: options.called === true ? [keys[0]!] : [],
		candidates: [
			{ key: keys[0]!, name: 'Jane Smith', party: 'D', pct: 50, votes },
			{ key: keys[1]!, name: 'John Doe', party: 'R', pct: 50, votes: votes / 2 },
		],
		observedAt: at,
		pctIn: 50,
		...(source === 'air' ? {} : { providerRaceId: '77' }),
		raceKey: options.raceKey ?? (source === 'air' ? HEADING : RACE),
		reportedAt: null,
		source,
		...(source === 'air' ? { templateId: options.templateId ?? 'ticker_v1' } : {}),
	};
};

const types = (anomalies: { type: string }[]): string[] => anomalies.map((a) => a.type);

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-comp-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

describe('ingest', () => {
	it('links each source to the DDHQ race, and keeps only what says something new', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100)]);
		composition.ingest([observation('Ross', 2_000, 100, { raceKey: 'its-own-key' })]);
		composition.ingest([observation('Ross', 3_000, 100, { raceKey: 'its-own-key' })]);
		const ingested = composition.ingest([observation('air', 4_000, 100)]);

		expect(composition.store.getRaceKeys()).toEqual([RACE]);
		expect(composition.store.getVendorHistory(RACE)).toHaveLength(1);
		expect(ingested.observations[0]).toMatchObject({
			providerRaceId: '77',
			raceKey: RACE,
			sourceRaceKey: HEADING,
		});
		expect(ingested.recorded).toHaveLength(1);
	});

	it('checks an air read once, as of the read, and raises what it finds', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100), observation('Ross', 1_000, 100)]);
		// A poll alone raises nothing, whatever it says.
		expect(composition.ingest([observation('Ross', 2_000, 120)]).events).toEqual([]);

		const wrong = composition.ingest([observation('air', 10_000, 150)]);
		expect(wrong.events.map((event) => [event.kind, event.type, event.subject])).toEqual([
			['raised', 'votes_mismatch', 'Jane Smith'],
			['raised', 'votes_mismatch', 'John Doe'],
		]);
		expect(composition.ingest([observation('air', 20_000, 120)]).events.map((e) => e.kind)).toEqual(
			['cleared', 'cleared'],
		);
	});
});

describe('an air read is a record', () => {
	it('stays a mismatch after Ross catches up, beside what Ross said at the time', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100), observation('Ross', 1_000, 100)]);
		composition.ingest([observation('air', 10_000, 150)]);
		const asRead = (): unknown =>
			composition.latestReads().map((checked) => ({
				found: types(checked.anomalies),
				ross: checked.vendor?.candidates[0]?.votes,
			}));
		const before = asRead();
		expect(before).toEqual([{ found: ['votes_mismatch', 'votes_mismatch'], ross: 100 }]);

		composition.ingest([observation('Ross', 11_000, 150)]);
		expect(asRead()).toEqual(before);

		// The next read of the race is a new record; the race's history keeps both.
		composition.ingest([observation('air', 20_000, 150)]);
		expect(asRead()).toEqual([{ found: [], ross: 150 }]);
		expect(
			composition
				.readsOf(RACE)
				.map((checked) => [
					checked.read.observedAt,
					checked.vendor?.candidates[0]?.votes,
					checked.anomalies.length,
				]),
		).toEqual([
			[20_000, 150, 0],
			[10_000, 100, 2],
		]);
	});

	it('stays a premature call after DDHQ makes the call', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100)]);
		composition.ingest([observation('air', 10_000, 100, { called: true })]);
		composition.ingest([observation('DDHQ', 11_000, 100, { called: true })]);
		expect(types(composition.latestReads()[0]!.anomalies)).toEqual(['premature_call']);
	});

	it('shows what DDHQ was saying at the read, not what it says now', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100)]);
		composition.ingest([observation('air', 10_000, 100)]);
		composition.ingest([observation('DDHQ', 11_000, 300)]);
		expect(composition.latestReads()[0]!.provider?.candidates[0]?.votes).toBe(100);
	});
});

describe('a misspelled name on air', () => {
	it('reaches its race and is flagged there', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100), observation('Ross', 1_000, 100)]);
		const read = observation('air', 10_000, 100);
		read.candidates[0] = { ...read.candidates[0]!, key: 'Jane Smyth', name: 'Jane Smyth' };
		const ingested = composition.ingest([read]);
		expect(ingested.observations[0]!.raceKey).toBe(RACE);
		expect(ingested.events.map((event) => [event.type, event.subject])).toEqual([
			['name_mismatch', 'Jane Smyth'],
			['votes_mismatch', 'Jane Smyth'],
		]);
	});
});

describe('reset', () => {
	it('forgets every observation and alert, so a new session starts from nothing', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100), observation('Ross', 1_000, 100)]);
		composition.ingest([observation('air', 10_000, 150)]);
		composition.reset();
		expect(composition.store.getRaceKeys()).toEqual([]);
		expect(composition.latestReads()).toEqual([]);
		expect(composition.alertLog.recent()).toEqual([]);
		// The same finding is new again, not a continuation of the last session's.
		composition.ingest([observation('Ross', 20_000, 100)]);
		const again = composition.ingest([observation('air', 30_000, 150)]);
		expect(again.observations[0]!.raceKey).toBe(RACE);
		expect(again.events.map((event) => event.kind)).toEqual(['raised', 'raised']);
	});
});

describe('latestReads', () => {
	it('lists each aired race once, as its latest read, newest first; polls never move a race', () => {
		const composition = makeComposition();
		composition.ingest([observation('air', 1_000, 100, { raceKey: 'OK U.S. SENATE' })]);
		composition.ingest([observation('air', 2_000, 100)]);
		composition.ingest([observation('DDHQ', 3_000, 100), observation('Ross', 3_000, 100)]);
		const listed = (): unknown =>
			composition.latestReads().map(({ read }) => [read.sourceRaceKey, read.observedAt]);
		expect(listed()).toEqual([
			[HEADING, 2_000],
			['OK U.S. SENATE', 1_000],
		]);
		composition.ingest([observation('air', 4_000, 100, { raceKey: 'OK U.S. SENATE' })]);
		expect(listed()).toEqual([
			['OK U.S. SENATE', 4_000],
			[HEADING, 2_000],
		]);
	});

	it('lets the graphic with something wrong stand for a race one frame shows on two', () => {
		const composition = makeComposition();
		composition.ingest([observation('DDHQ', 1_000, 100), observation('Ross', 1_000, 100)]);
		composition.ingest([
			observation('air', 10_000, 100, { called: true, templateId: 'lower_third' }),
			observation('air', 10_000, 100, { templateId: 'ticker_v1' }),
		]);
		expect(
			composition
				.latestReads()
				.map((checked) => [checked.read.templateId, types(checked.anomalies)]),
		).toEqual([['lower_third', ['premature_call']]]);
	});
});

describe('recorder → player → composition round-trip', () => {
	it('records what the store kept, and replays into a fresh composition with the same findings', () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'rt-1' });
		const liveComposition = makeComposition({ onRecord: recorder.recordObservation });

		liveComposition.ingest([observation('DDHQ', 1_000, 100)]);
		liveComposition.ingest([observation('DDHQ', 1_005, 100)]);
		liveComposition.ingest([observation('air', 1_010, 100, { called: true })]);
		recorder.close();

		const found = liveComposition.latestReads().map((checked) => types(checked.anomalies));
		expect(found).toEqual([['premature_call']]);

		const player = makePlayer({ baseDir, sessionId: 'rt-1' });
		const recorded = player.readObservations();
		player.close();
		expect(recorded.map((entry) => entry.observedAt)).toEqual([1_000, 1_010]);

		const replayComposition = makeComposition();
		recorded.forEach((entry) => replayComposition.ingest([entry]));
		expect(replayComposition.latestReads().map((checked) => types(checked.anomalies))).toEqual(
			found,
		);
	});
});
