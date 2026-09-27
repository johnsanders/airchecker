import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

import type { CandidateState, RaceObservation } from '../reconcile/reconcile.js';

import { DEFAULT_MODEL, DEFAULT_RECALL_MODEL, extractFrame } from '../vision/extractFrame.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { redactError } from '../vision/redact.js';
import { formatUsage, makeUsageMeter } from './usageMeter.js';

// Repeatability check: run the live extractor N times against each golden's
// frame and report how many runs reproduce the golden's data EXACTLY (names
// compared case-insensitively, since the model varies casing). On any drift,
// print the field that differed so we see whether it's a real misread or just
// casing. Over several goldens (or `all`) it also tallies drifts by field and
// totals what the run cost per model — this is the model-comparison harness.
//
//   node --env-file-if-exists=.env --import tsx src/tools/verifyExtraction.ts <goldenName...|all> [runs] [--model X] [--recall-model Y] [--reasoning E] [--width W]
//     --width downscales each golden frame first, to test a lower-resolution feed
//     model IDs with a slash (google/gemini-3.8-flash) go to OpenRouter, others to Anthropic

type GoldenDoc = { frame: string; observations: RaceObservation[] };

const canonCandidate = (candidate: CandidateState): string =>
	JSON.stringify({
		name: candidate.name.toLowerCase(),
		party: candidate.party,
		pct: candidate.pct,
		votes: candidate.votes,
	});

const canonCalledFor = (calledFor: readonly string[]): string =>
	calledFor
		.map((value) => value.toLowerCase())
		.sort()
		.join('+');

const canonObservation = (observation: RaceObservation): string =>
	JSON.stringify({
		calledFor: canonCalledFor(observation.calledFor),
		candidates: observation.candidates.map(canonCandidate),
		pctIn: observation.pctIn,
		raceKey: observation.raceKey,
		templateId: observation.templateId,
	});

const canonFrame = (observations: RaceObservation[]): string =>
	JSON.stringify(observations.map(canonObservation).sort());

// Human-readable field diff between expected and actual observation sets.
const diff = (expected: RaceObservation[], actual: RaceObservation[]): string[] => {
	const lines: string[] = [];
	if (expected.length !== actual.length)
		lines.push(`template count: expected ${expected.length}, got ${actual.length}`);
	expected.forEach((exp, index) => {
		const act = actual[index];
		if (act === undefined) {
			lines.push(`[${index}] missing (expected ${exp.templateId} / ${exp.raceKey})`);
			return;
		}
		if (exp.templateId !== act.templateId)
			lines.push(`[${index}] templateId: ${exp.templateId} → ${act.templateId}`);
		if (exp.raceKey !== act.raceKey)
			lines.push(`[${index}] raceKey: "${exp.raceKey}" → "${act.raceKey}"`);
		if (exp.pctIn !== act.pctIn) lines.push(`[${index}] pctIn: ${exp.pctIn} → ${act.pctIn}`);
		const expCalled = canonCalledFor(exp.calledFor);
		const actCalled = canonCalledFor(act.calledFor);
		if (expCalled !== actCalled) lines.push(`[${index}] calledFor: ${expCalled} → ${actCalled}`);
		if (exp.candidates.length !== act.candidates.length)
			lines.push(`[${index}] candidate count: ${exp.candidates.length} → ${act.candidates.length}`);
		exp.candidates.forEach((expC, ci) => {
			const actC = act.candidates[ci];
			if (actC === undefined) {
				lines.push(`[${index}].cand[${ci}] missing (expected ${expC.name})`);
				return;
			}
			if (expC.name.toLowerCase() !== actC.name.toLowerCase())
				lines.push(`[${index}].cand[${ci}] name: "${expC.name}" → "${actC.name}"`);
			if (expC.party !== actC.party)
				lines.push(`[${index}].cand[${ci}] party: ${expC.party} → ${actC.party}`);
			if (expC.votes !== actC.votes)
				lines.push(`[${index}].cand[${ci}] votes: ${expC.votes} → ${actC.votes}`);
			if (expC.pct !== actC.pct)
				lines.push(`[${index}].cand[${ci}] pct: ${expC.pct} → ${actC.pct}`);
		});
	});
	return lines;
};

const DRIFT_KINDS: readonly [string, string][] = [
	['error', 'error:'],
	['calledFor', 'calledFor:'],
	['pctIn', 'pctIn:'],
	['votes', ' votes:'],
	['pct', ' pct:'],
	['name', ' name:'],
	['party', ' party:'],
	['raceKey', 'raceKey:'],
	['templateId', 'templateId:'],
];

const driftKind = (line: string): string =>
	DRIFT_KINDS.find(([, needle]) => line.includes(needle))?.[0] ?? 'structure';

const FLAGS_WITH_VALUE = new Set(['--model', '--reasoning', '--recall-model', '--width']);

const flagValue = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
};

const positionals = (): string[] =>
	process.argv
		.slice(2)
		.filter(
			(arg, index, all) => !arg.startsWith('--') && !FLAGS_WITH_VALUE.has(all[index - 1] ?? ''),
		);

const GOLDEN_SUFFIX = '.golden.json';

const run = async (): Promise<void> => {
	const args = positionals();
	const runsArg = args.find((arg) => /^\d+$/.test(arg));
	const runs = runsArg === undefined ? 10 : Number(runsArg);
	const requested = args.filter((arg) => arg !== runsArg);
	if (requested.length === 0) {
		console.error(
			'Usage: node --env-file-if-exists=.env --import tsx src/tools/verifyExtraction.ts <goldenName...|all> [runs] [--model X] [--recall-model Y] [--reasoning E] [--width W]',
		);
		process.exit(1);
	}
	const model = flagValue('--model');
	const recallModel = flagValue('--recall-model');
	const missingKeys = missingLiveKeys([
		model ?? DEFAULT_MODEL,
		recallModel ?? DEFAULT_RECALL_MODEL,
	]);
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set — verification makes live calls.`);
		process.exit(1);
	}
	const goldensDir = 'recordings/goldens';
	const names = requested.includes('all')
		? readdirSync(goldensDir)
				.filter((file) => file.endsWith(GOLDEN_SUFFIX))
				.map((file) => file.slice(0, -GOLDEN_SUFFIX.length))
		: requested;
	const reasoning = flagValue('--reasoning');
	const widthArg = flagValue('--width');
	const width = widthArg === undefined ? undefined : Number(widthArg);
	console.log(
		`model=${model ?? DEFAULT_MODEL} recallModel=${recallModel ?? DEFAULT_RECALL_MODEL} reasoning=${reasoning ?? 'low (client default)'} width=${width ?? 'native'} runs=${runs} goldens=${names.length}\n`,
	);

	const meter = makeUsageMeter(
		makeLiveLlmClient(reasoning === undefined ? {} : { reasoningEffort: reasoning }),
	);
	const deps = {
		client: meter.client,
		...(model === undefined ? {} : { model }),
		...(recallModel === undefined ? {} : { recallModel }),
	};
	const kindTotals = new Map<string, number>();
	let totalExact = 0;
	let errors = 0;

	for (const name of names) {
		const doc = JSON.parse(
			readFileSync(join(goldensDir, `${name}${GOLDEN_SUFFIX}`), 'utf8'),
		) as GoldenDoc;
		const nativePng = readFileSync(join(goldensDir, doc.frame));
		const png =
			width === undefined ? nativePng : await sharp(nativePng).resize({ width }).png().toBuffer();
		const expectedCanon = canonFrame(doc.observations);
		let exact = 0;
		const driftCounts = new Map<string, number>();
		process.stdout.write(`${name} `);
		for (let attempt = 1; attempt <= runs; attempt++) {
			try {
				const observed = await extractFrame(png, 0, deps);
				if (canonFrame(observed) === expectedCanon) {
					exact += 1;
					process.stdout.write('.');
				} else {
					process.stdout.write('X');
					diff(doc.observations, observed).forEach((line) =>
						driftCounts.set(line, (driftCounts.get(line) ?? 0) + 1),
					);
				}
			} catch (error) {
				errors += 1;
				process.stdout.write('E');
				const line = `error: ${redactError(error).split('\n')[0] ?? ''}`;
				driftCounts.set(line, (driftCounts.get(line) ?? 0) + 1);
			}
		}
		console.log(`  ${exact}/${runs}`);
		Array.from(driftCounts.entries())
			.sort((a, b) => b[1] - a[1])
			.forEach(([line, count]) => {
				console.log(`    ${count}×  ${line}`);
				const kind = driftKind(line);
				kindTotals.set(kind, (kindTotals.get(kind) ?? 0) + count);
			});
		totalExact += exact;
	}

	const totalRuns = names.length * runs;
	console.log(
		`\nexact: ${totalExact}/${totalRuns} across ${names.length} goldens × ${runs} runs${errors > 0 ? `, ${errors} errored` : ''}`,
	);
	if (kindTotals.size > 0) {
		console.log('drift by field (# of drift lines):');
		Array.from(kindTotals.entries())
			.sort((a, b) => b[1] - a[1])
			.forEach(([kind, count]) => console.log(`  ${count}×  ${kind}`));
	}
	console.log('usage:');
	formatUsage(meter.totals(), totalRuns).forEach((line) => console.log(`  ${line}`));
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
