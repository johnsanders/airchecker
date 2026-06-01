import type { CandidateState, RaceObservation, SourceName } from '../reconcile/reconcile.js';

import { makeRaceIdentityResolver } from '../identity/raceIdentity.js';
import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { redactError } from '../vision/redact.js';

// Live shakeout of the race-identity LLM reconcile against the REAL Haiku model —
// the one piece that until now had only ever seen a stub. Registers two settled
// DDHQ canonicals, then feeds messy "air" headings and asks: does Haiku propose the
// RIGHT link (and refuse a wrong one)? Prints each decision + reason and a verdict.
//
//   ANTHROPIC_API_KEY=... npm run probe-identity
//
// In-memory only: no settings file, no recorder — nothing persists.

const candidate = (name: string, party: string, pct: number, votes: number): CandidateState => ({
	key: name,
	name,
	party,
	pct,
	votes,
});

const ddhqObs = (
	raceKey: string,
	candidates: CandidateState[],
	observedAt: number,
): RaceObservation => ({
	calledFor: [],
	candidates,
	observedAt,
	pctIn: 80,
	raceKey,
	reportedAt: null,
	source: 'DDHQ',
});

const airObs = (
	heading: string,
	candidates: CandidateState[],
	observedAt: number,
): RaceObservation => ({
	calledFor: [],
	candidates,
	extractedFields: { race_heading: heading },
	observedAt,
	pctIn: 80,
	raceKey: heading.toUpperCase(),
	reportedAt: null,
	source: 'air' satisfies SourceName,
	templateId: 'ticker_v1',
});

const TX34 = '2024-TX-US_House-34-NP-General';
const TX28 = '2024-TX-US_House-28-NP-General';

type Scenario = {
	air: RaceObservation;
	expect: 'match' | 'new';
	label: string;
	wantCanonical?: string;
};

const scenarios: Scenario[] = [
	{
		air: airObs(
			'Texas U.S. House Dist 34',
			[candidate('V. Gonzalez', 'D', 53, 91_000), candidate('M. Flores', 'R', 47, 80_000)],
			3_000,
		),
		expect: 'match',
		label: 'air TX-34 (messy heading, abbreviated names) → should link to TX-34 canonical',
		wantCanonical: TX34,
	},
	{
		air: airObs(
			'Texas U.S. House Dist 28',
			[candidate('Henry Cuellar', 'D', 51, 70_000), candidate('Jay Furman', 'R', 49, 67_000)],
			4_000,
		),
		expect: 'match',
		label: 'air TX-28 (different district) → should link to TX-28, NOT TX-34',
		wantCanonical: TX28,
	},
	{
		air: airObs(
			'Georgia Governor',
			[candidate('Brian Kemp', 'R', 52, 2_100_000), candidate('Stacey Abrams', 'D', 48, 1_900_000)],
			5_000,
		),
		expect: 'new',
		label: 'air GA Governor (unrelated race) → should propose NOTHING',
	},
];

const run = async (): Promise<void> => {
	if (process.env.ANTHROPIC_API_KEY === undefined) {
		console.error('ANTHROPIC_API_KEY is not set — this probe makes real Haiku calls and requires it.');
		process.exit(1);
	}

	const resolver = makeRaceIdentityResolver({
		llmClient: makeAnthropicLlmClient(),
		onError: (error) => console.error('  [resolver error]', redactError(error)),
	});

	// Settle the two DDHQ canonicals first.
	await resolver.resolveObservation(
		ddhqObs(
			TX34,
			[candidate('Vicente Gonzalez', 'D', 53, 91_000), candidate('Mayra Flores', 'R', 47, 80_000)],
			1_000,
		),
	);
	await resolver.resolveObservation(
		ddhqObs(
			TX28,
			[candidate('Henry Cuellar', 'D', 51, 70_000), candidate('Jay Furman', 'R', 49, 67_000)],
			2_000,
		),
	);
	console.log(`Registered 2 DDHQ canonicals:\n  ${TX34}\n  ${TX28}\n`);

	let passes = 0;
	for (const scenario of scenarios) {
		const before = new Set(resolver.getSnapshot().proposals.map((proposal) => proposal.id));
		await resolver.resolveObservation(scenario.air);
		await resolver.whenIdle();
		const fresh = resolver
			.getSnapshot()
			.proposals.filter((proposal) => !before.has(proposal.id) && proposal.status === 'pending');

		const proposed = fresh[0];
		const ok =
			scenario.expect === 'new'
				? proposed === undefined
				: proposed !== undefined && proposed.candidateCanonicalRaceKey === scenario.wantCanonical;
		if (ok) passes += 1;

		console.log(`${ok ? 'PASS' : 'FAIL'} — ${scenario.label}`);
		if (proposed === undefined) {
			console.log('  → no proposal (Haiku said new/uncertain, or no candidate matched)');
		} else {
			console.log(`  → proposed link to: ${proposed.candidateCanonicalRaceKey}`);
			console.log(`  → reason: ${proposed.reason}`);
		}
		console.log('');
	}

	console.log(`${passes}/${scenarios.length} scenarios behaved as expected.`);
	process.exit(passes === scenarios.length ? 0 : 2);
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
