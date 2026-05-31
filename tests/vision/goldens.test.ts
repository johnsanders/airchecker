import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';
import { extractFrame } from '../../src/vision/extractFrame.js';
import { makeGoldenClient } from '../../src/vision/goldenClient.js';
import type { Golden } from '../../src/vision/goldenClient.js';

const here = dirname(fileURLToPath(import.meta.url));
const goldensDir = resolve(here, '..', '..', 'recordings', 'goldens');

type GoldenDoc = {
  frame: string;
  goldens: Golden[];
  name: string;
  observations: RaceObservation[];
};

const goldenFiles = existsSync(goldensDir)
  ? readdirSync(goldensDir).filter((file) => file.endsWith('.golden.json'))
  : [];

// Compare observations ignoring candidate name CASE — the VLM varies casing
// run-to-run (JOHN COWAN vs John Cowan), so the recorded names are normalized
// for the assertion while everything else must match exactly.
const lowerNames = (observation: RaceObservation): RaceObservation => ({
  ...observation,
  calledFor: observation.calledFor.map((value) => value.toLowerCase()).sort(),
  candidates: observation.candidates.map((candidate) => ({
    ...candidate,
    key: candidate.key.toLowerCase(),
    name: candidate.name.toLowerCase(),
  })),
});

describe('golden replays', () => {
  it('has at least one golden to replay', () => {
    expect(goldenFiles.length).toBeGreaterThan(0);
  });

  goldenFiles.forEach((file) => {
    it(`replays ${file} deterministically with no API key`, async () => {
      const doc = JSON.parse(readFileSync(join(goldensDir, file), 'utf8')) as GoldenDoc;
      const png = readFileSync(join(goldensDir, doc.frame));
      const client = makeGoldenClient(doc.goldens);

      // Full two-pass replay (pass 1 + recall votes), all served from the golden.
      const observed = await extractFrame(png, 0, { client });

      expect(observed.map(lowerNames)).toEqual(doc.observations.map(lowerNames));
    });
  });
});
