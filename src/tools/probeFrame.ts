import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { extractFrame } from '../vision/extractFrame.js';
import { redactError } from '../vision/redact.js';

// One real Messages-API vision call against a single frame, printing the parsed
// air observations. Use it to answer "does the model read this frame correctly?"
// — especially the ticker, whose small vote totals are the open resolution risk.
//
//   ANTHROPIC_API_KEY=... npm run probe -- recordings/reference-frames/ticker_1920.png
//
// Pass --maxwidth N to downscale before sending (defaults to no resize) — set it
// to 1432 to simulate the API's ~1.15MP auto-shrink and see if the ticker survives.

const run = async (): Promise<void> => {
  const framePath = process.argv[2];
  if (framePath === undefined) {
    console.error('Usage: npm run probe -- <framePng> [--maxwidth N]');
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('ANTHROPIC_API_KEY is not set — live mode requires it.');
    process.exit(1);
  }

  const maxWidthFlag = process.argv.indexOf('--maxwidth');
  const maxWidth = maxWidthFlag === -1 ? undefined : Number(process.argv[maxWidthFlag + 1]);

  const original = readFileSync(framePath);
  const png =
    maxWidth === undefined
      ? original
      : await sharp(original).resize({ width: maxWidth, withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(png).metadata();
  console.log(`frame ${framePath} → sending ${meta.width}×${meta.height}`);

  const client = makeAnthropicLlmClient();
  const observations = await extractFrame(png, Date.now(), { client });

  console.log(`\n${observations.length} template(s) detected:\n`);
  observations.forEach((observation) => {
    console.log(`  [${observation.templateId}] raceKey=${observation.raceKey} pctIn=${observation.pctIn} calledFor=${observation.calledFor ?? '—'}`);
    observation.candidates.forEach((candidate) => {
      console.log(`    ${candidate.party} ${candidate.name} — ${candidate.pct}% / ${candidate.votes.toLocaleString()}`);
    });
  });
};

run().catch((error: unknown) => {
  console.error(redactError(error));
  process.exit(1);
});
