import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { extractFrame } from '../vision/extractFrame.js';
import type { Golden } from '../vision/goldenClient.js';
import { hashPrompt } from '../vision/llmClient.js';
import type { LlmClient } from '../vision/llmClient.js';
import { redactError } from '../vision/redact.js';

// Captures a golden: one real VLM call against a frame, recording the exact
// (frameSha256, promptHash, response) the live path produced plus the resulting
// observations, so a stubbed replay can assert against it with no API key.
//
//   npm run capture-golden -- <framePng> <goldenName>
//
// Writes recordings/goldens/<goldenName>.golden.json and copies the frame in.

// Decorator that snapshots the request/response passing through the real client.
// Records EVERY frame-bearing call (pass 1 + each recall vote) as its own golden
// entry, so a stubbed replay can satisfy the full two-pass flow with no API key.
const makeCapturingClient = (underlying: LlmClient, sink: Golden[]): LlmClient => ({
  call: async (request) => {
    const response = await underlying.call(request);
    const frameSha256 =
      request.image === undefined
        ? null
        : createHash('sha256').update(Buffer.from(request.image.base64, 'base64')).digest('hex');
    if (frameSha256 !== null)
      sink.push({
        frameSha256,
        model: response.model,
        promptHash: hashPrompt(request),
        response: response.body,
      });
    return response;
  },
});

const run = async (): Promise<void> => {
  const framePath = process.argv[2];
  const goldenName = process.argv[3];
  if (framePath === undefined || goldenName === undefined) {
    console.error('Usage: npm run capture-golden -- <framePng> <goldenName>');
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('ANTHROPIC_API_KEY is not set — capturing a golden requires a live call.');
    process.exit(1);
  }

  const png = readFileSync(framePath);
  const sink: Golden[] = [];
  const client = makeCapturingClient(makeAnthropicLlmClient(), sink);
  const observations = await extractFrame(png, 0, { client });

  if (sink.length === 0) throw new Error('no frame request was captured');

  const outDir = 'recordings/goldens';
  mkdirSync(outDir, { recursive: true });
  const frameFile = `${goldenName}.png`;
  copyFileSync(framePath, join(outDir, frameFile));

  const goldenDoc = {
    frame: frameFile,
    goldens: sink,
    name: goldenName,
    observations,
    sourceFrame: basename(framePath),
  };
  const outPath = join(outDir, `${goldenName}.golden.json`);
  writeFileSync(outPath, `${JSON.stringify(goldenDoc, null, 2)}\n`);

  console.log(`captured ${observations.length} observation(s) → ${outPath}`);
  observations.forEach((observation) => {
    console.log(`  [${observation.templateId}] ${observation.raceKey} — ${observation.candidates.length} candidates`);
  });
};

run().catch((error: unknown) => {
  console.error(redactError(error));
  process.exit(1);
});
