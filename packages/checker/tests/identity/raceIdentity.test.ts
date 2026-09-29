import { describe, expect, it } from 'vitest';

import type { RaceObservation, SourceName } from '../../src/reconcile/reconcile.js';
import type { LlmClient } from '../../src/vision/llmClient.js';

import { makeRaceIdentityResolver } from '../../src/identity/raceIdentity.js';
import makeStore from '../../src/store/store.js';

const obs = (source: SourceName, raceKey: string, at = 1_000): RaceObservation => ({
	calledFor: [],
	candidates: [
		{ key: 'a', name: 'Jane Smith', party: 'D', pct: 55, votes: 100 },
		{ key: 'b', name: 'John Doe', party: 'R', pct: 45, votes: 80 },
	],
	observedAt: at,
	pctIn: 50,
	raceKey,
	reportedAt: null,
	source,
});

const matchClient = (counter: { calls: number }): LlmClient => ({
	call: async () => {
		counter.calls += 1;
		return {
			body: { canonicalRaceKey: 'DDHQ:RACE', decision: 'match', reason: 'same office and roster' },
			model: 'claude-haiku-4-5',
		};
	},
});

describe('race identity resolver', () => {
	it('registers DDHQ as canonical and aliases it to itself', async () => {
		const resolver = makeRaceIdentityResolver();
		const resolved = await resolver.resolveObservation(obs('DDHQ', '2026-TX-Senate-AL-R-General'));

		expect(resolved.raceKey).toBe('2026-TX-Senate-AL-R-General');
		expect(resolved.sourceRaceKey).toBe('2026-TX-Senate-AL-R-General');
		expect(resolver.getSnapshot().canonicalRaces[0]).toMatchObject({
			canonicalRaceKey: '2026-TX-Senate-AL-R-General',
			provisional: false,
		});
		expect(resolver.getAlias('DDHQ', '2026-TX-Senate-AL-R-General')?.method).toBe('provider');
	});

	it('creates a provisional canonical race when air appears before DDHQ', async () => {
		const resolver = makeRaceIdentityResolver();
		const resolved = await resolver.resolveObservation(obs('air', 'TX U.S. SENATE (R)'));

		expect(resolved.raceKey).toBe('provisional:air:TX-U-S-SENATE-R');
		expect(resolver.getSnapshot().canonicalRaces[0]?.provisional).toBe(true);
		expect(resolver.getAlias('air', 'TX U.S. SENATE (R)')?.method).toBe('provisional');
	});

	it('deterministically links normalized source keys to a DDHQ canonical race', async () => {
		const resolver = makeRaceIdentityResolver();
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US Senate-AL-R-General'));
		const resolved = await resolver.resolveObservation(
			obs('Ross', '2026 tx us senate al r general'),
		);

		expect(resolved.raceKey).toBe('2026-TX-US Senate-AL-R-General');
		expect(resolver.getAlias('Ross', '2026 tx us senate al r general')?.method).toBe(
			'deterministic',
		);
	});

	it('links a vendor race seen before its DDHQ canonical, on a later sighting', async () => {
		const resolver = makeRaceIdentityResolver();

		// Ross polls before any DDHQ canonical exists → parked in a provisional bucket.
		const early = await resolver.resolveObservation(obs('Ross', '2026-TX-US Senate-AL-R-General'));
		expect(early.raceKey).toBe('provisional:Ross:2026-TX-US-Senate-AL-R-General');

		// DDHQ canonical lands.
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US Senate-AL-R-General', 2_000));

		// The next Ross sighting re-attempts and links deterministically (no LLM needed).
		const linked = await resolver.resolveObservation(
			obs('Ross', '2026-TX-US Senate-AL-R-General', 3_000),
		);
		expect(linked.raceKey).toBe('2026-TX-US Senate-AL-R-General');
		expect(resolver.getAlias('Ross', '2026-TX-US Senate-AL-R-General')?.method).toBe(
			'deterministic',
		);
	});

	it('links a vendor race by its DDHQ race_id even when the keys differ', async () => {
		const resolver = makeRaceIdentityResolver();
		await resolver.resolveObservation({
			...obs('DDHQ', '2026-TX-US_House-9-NP-General_Election'),
			providerRaceId: '295078',
		});
		const resolved = await resolver.resolveObservation({
			...obs('Ross', '2026-TX-US_House-09-NP-General'),
			providerRaceId: '295078',
		});

		expect(resolved.raceKey).toBe('2026-TX-US_House-9-NP-General_Election');
		expect(resolver.getAlias('Ross', '2026-TX-US_House-09-NP-General')?.method).toBe(
			'deterministic',
		);
	});

	it('never links a vendor race with a race_id by key, nor asks Haiku; it waits for that race', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation({
			...obs('DDHQ', '2026-TX-US Senate-AL-R-General'),
			providerRaceId: '111',
		});

		const early = await resolver.resolveObservation({
			...obs('Ross', '2026-TX-US Senate-AL-R-General', 2_000),
			providerRaceId: '222',
		});
		await resolver.whenIdle();
		expect(early.raceKey).toBe('provisional:Ross:2026-TX-US-Senate-AL-R-General');
		expect(counter.calls).toBe(0);

		await resolver.resolveObservation({
			...obs('DDHQ', '2026-TX-US Senate-AL-R-Special', 3_000),
			providerRaceId: '222',
		});
		const linked = await resolver.resolveObservation({
			...obs('Ross', '2026-TX-US Senate-AL-R-General', 4_000),
			providerRaceId: '222',
		});
		expect(linked.raceKey).toBe('2026-TX-US Senate-AL-R-Special');
		expect(counter.calls).toBe(0);
	});

	it('reconciles an air race seen before DDHQ once the canonical lands, exactly once', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });

		// Air first — nothing settled to match against, so no Haiku call and no proposal yet.
		const early = await resolver.resolveObservation(obs('air', 'AIR HEADING'));
		await resolver.whenIdle();
		expect(early.raceKey).toBe('provisional:air:AIR-HEADING');
		expect(counter.calls).toBe(0);
		expect(resolver.getSnapshot().proposals).toHaveLength(0);

		// DDHQ canonical appears.
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE', 2_000));

		// Next air sighting fires exactly one Haiku reconcile → a pending proposal.
		await resolver.resolveObservation(obs('air', 'AIR HEADING', 3_000));
		await resolver.whenIdle();
		expect(counter.calls).toBe(1);
		expect(resolver.getSnapshot().proposals[0]?.status).toBe('pending');

		// Further sightings never re-ask Haiku.
		await resolver.resolveObservation(obs('air', 'AIR HEADING', 4_000));
		await resolver.whenIdle();
		expect(counter.calls).toBe(1);
	});

	it('links an air race by its heading when exactly one DDHQ race fits, without Haiku', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US_House-15-NP-General_Election'));
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US_House-1-NP-General_Election'));
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US_Senate-AL-NP-General_Election'));

		const house = await resolver.resolveObservation(obs('air', 'TX-15 U.S. HOUSE', 2_000));
		const senate = await resolver.resolveObservation(obs('air', 'TX U.S. SENATE', 2_000));
		await resolver.whenIdle();
		expect(house.raceKey).toBe('2026-TX-US_House-15-NP-General_Election');
		expect(senate.raceKey).toBe('2026-TX-US_Senate-AL-NP-General_Election');
		expect(resolver.getAlias('air', 'TX-15 U.S. HOUSE')?.method).toBe('deterministic');
		expect(counter.calls).toBe(0);
	});

	it('leaves a heading to Haiku when its names are not on that race (a misread district)', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation(obs('DDHQ', '2026-TX-US_House-15-NP-General_Election'));
		await resolver.resolveObservation({
			...obs('DDHQ', '2026-TX-US_House-16-NP-General_Election'),
			candidates: [{ key: 'c', name: 'Pat Other', party: 'D', pct: 50, votes: 10 }],
		});

		// Jane Smith and John Doe run in TX-15, so a "TX-16" heading over them is a misread.
		const misread = await resolver.resolveObservation(obs('air', 'TX-16 U.S. HOUSE', 2_000));
		await resolver.whenIdle();
		expect(misread.raceKey).toBe('provisional:air:TX-16-U-S-HOUSE');
		expect(counter.calls).toBe(1);
	});

	it('reports a race that leaves its provisional bucket, so the store can move it', async () => {
		const relinks: string[] = [];
		const resolver = makeRaceIdentityResolver({
			onRelink: (source, sourceRaceKey, canonicalRaceKey) =>
				relinks.push(`${source} ${sourceRaceKey} → ${canonicalRaceKey}`),
		});
		await resolver.resolveObservation(obs('Ross', '2026-TX-US_Senate-AL-NP-General_Election'));
		await resolver.resolveObservation(obs('air', 'TX U.S. SENATE'));
		await resolver.resolveObservation(
			obs('DDHQ', '2026-TX-US_Senate-AL-NP-General_Election', 2_000),
		);
		await resolver.resolveObservation(
			obs('Ross', '2026-TX-US_Senate-AL-NP-General_Election', 3_000),
		);
		await resolver.resolveObservation(obs('air', 'TX U.S. SENATE', 3_000));
		// Linked from the start: nothing to move.
		await resolver.resolveObservation(obs('air', 'TX U.S. SENATE', 4_000));

		expect(relinks).toEqual([
			'Ross 2026-TX-US_Senate-AL-NP-General_Election → 2026-TX-US_Senate-AL-NP-General_Election',
			'air TX U.S. SENATE → 2026-TX-US_Senate-AL-NP-General_Election',
		]);
	});

	it('keeps Haiku matches pending until accepted', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE'));
		const resolved = await resolver.resolveObservation(obs('air', 'AIR HEADING'));
		await resolver.whenIdle();

		expect(resolved.raceKey).toBe('provisional:air:AIR-HEADING');
		const proposal = resolver.getSnapshot().proposals[0]!;
		expect(proposal.status).toBe('pending');

		const alias = resolver.acceptProposal(proposal.id, 2_000);
		expect(alias?.canonicalRaceKey).toBe('DDHQ:RACE');
		expect(resolver.getAlias('air', 'AIR HEADING')?.method).toBe('proposal');
	});

	it('does not resurface a rejected proposal, and never re-asks Haiku', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE'));
		await resolver.resolveObservation(obs('air', 'AIR HEADING'));
		await resolver.whenIdle();
		const proposal = resolver.getSnapshot().proposals[0]!;
		resolver.rejectProposal(proposal.id, 2_000);

		await resolver.resolveObservation(obs('air', 'AIR HEADING', 3_000));
		await resolver.whenIdle();

		expect(counter.calls).toBe(1);
		expect(resolver.getSnapshot().proposals.filter((p) => p.status === 'pending')).toHaveLength(0);
	});

	it('asks Haiku about air races only; a Ross race waits to link by race_id', async () => {
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({ llmClient: matchClient(counter) });
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE'));
		await resolver.resolveObservation(obs('Ross', 'ROSS RACE'));
		await resolver.whenIdle();

		expect(counter.calls).toBe(0);
		expect(resolver.getSnapshot().proposals).toHaveLength(0);
	});

	it('forgets every link on reset, in memory and in settings', async () => {
		let saved: unknown;
		const counter = { calls: 0 };
		const resolver = makeRaceIdentityResolver({
			llmClient: matchClient(counter),
			settings: {
				getIdentityState: () => saved,
				setIdentityState: (state) => {
					saved = state;
				},
			},
		});
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE'));
		await resolver.resolveObservation(obs('air', 'AIR HEADING'));
		await resolver.whenIdle();

		resolver.reset();
		expect(resolver.getSnapshot()).toEqual({ aliases: [], canonicalRaces: [], proposals: [] });
		expect(saved).toEqual({ aliases: [], canonicalRaces: [], proposals: [] });

		// A sighting after the reset gets its one Haiku reconcile again.
		await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE', 2_000));
		await resolver.resolveObservation(obs('air', 'AIR HEADING', 2_000));
		await resolver.whenIdle();
		expect(counter.calls).toBe(2);
	});
});

describe('race identity relink with store history', () => {
	it('moves retained observations into the target canonical bucket', async () => {
		const resolver = makeRaceIdentityResolver();
		const store = makeStore();

		const air = await resolver.resolveObservation(obs('air', 'AIR HEADING'));
		store.record(air);
		const ddhq = await resolver.resolveObservation(obs('DDHQ', 'DDHQ:RACE', 2_000));
		store.record(ddhq);
		const alias = resolver.manualRelink('air', 'AIR HEADING', 'DDHQ:RACE', 3_000)!;
		const rekeyed = store.rekeySourceRace(
			alias.source,
			alias.sourceRaceKey,
			alias.canonicalRaceKey,
		);

		expect(rekeyed.updated).toBe(1);
		expect(store.getAirHistory('provisional:air:AIR-HEADING')).toHaveLength(0);
		expect(store.getAirHistory('DDHQ:RACE')).toHaveLength(1);
		expect(store.getProviderHistory('DDHQ:RACE')).toHaveLength(1);
	});
});
