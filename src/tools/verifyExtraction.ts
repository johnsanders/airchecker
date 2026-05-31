import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CandidateState, RaceObservation } from '../reconcile/reconcile.js';
import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { extractFrame } from '../vision/extractFrame.js';
import { redactError } from '../vision/redact.js';

// Repeatability check: run the live extractor N times against a golden's frame
// and report how many runs reproduce the golden's data EXACTLY (names compared
// case-insensitively, since the model varies casing). On any drift, print the
// field that differed so we see whether it's a real misread or just casing.
//
//   npm run verify -- <goldenName> [runs]

type GoldenDoc = { frame: string; observations: RaceObservation[] };

const canonCandidate = (candidate: CandidateState): string =>
  JSON.stringify({
    name: candidate.name.toLowerCase(),
    party: candidate.party,
    pct: candidate.pct,
    votes: candidate.votes,
  });

const canonCalledFor = (calledFor: readonly string[]): string =>
  calledFor.map((value) => value.toLowerCase()).sort().join('+');

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
    if (exp.raceKey !== act.raceKey) lines.push(`[${index}] raceKey: "${exp.raceKey}" → "${act.raceKey}"`);
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
      if (expC.party !== actC.party) lines.push(`[${index}].cand[${ci}] party: ${expC.party} → ${actC.party}`);
      if (expC.votes !== actC.votes) lines.push(`[${index}].cand[${ci}] votes: ${expC.votes} → ${actC.votes}`);
      if (expC.pct !== actC.pct) lines.push(`[${index}].cand[${ci}] pct: ${expC.pct} → ${actC.pct}`);
    });
  });
  return lines;
};

const run = async (): Promise<void> => {
  const goldenName = process.argv[2];
  const runs = process.argv[3] === undefined ? 10 : Number(process.argv[3]);
  if (goldenName === undefined) {
    console.error('Usage: npm run verify -- <goldenName> [runs]');
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('ANTHROPIC_API_KEY is not set — verification makes live calls.');
    process.exit(1);
  }

  const goldensDir = 'recordings/goldens';
  const doc = JSON.parse(readFileSync(join(goldensDir, `${goldenName}.golden.json`), 'utf8')) as GoldenDoc;
  const png = readFileSync(join(goldensDir, doc.frame));
  const expectedCanon = canonFrame(doc.observations);

  const client = makeAnthropicLlmClient();
  let exact = 0;
  const driftCounts = new Map<string, number>();

  for (let attempt = 1; attempt <= runs; attempt++) {
    const observed = await extractFrame(png, 0, { client });
    if (canonFrame(observed) === expectedCanon) {
      exact += 1;
      process.stdout.write('.');
    } else {
      process.stdout.write('X');
      diff(doc.observations, observed).forEach((line) =>
        driftCounts.set(line, (driftCounts.get(line) ?? 0) + 1),
      );
    }
  }

  console.log(`\n\n${goldenName}: ${exact}/${runs} runs reproduced the golden exactly (names case-insensitive).`);
  if (driftCounts.size > 0) {
    console.log('\nField drifts observed (line → # of runs):');
    Array.from(driftCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([line, count]) => console.log(`  ${count}×  ${line}`));
  }
};

run().catch((error: unknown) => {
  console.error(redactError(error));
  process.exit(1);
});
