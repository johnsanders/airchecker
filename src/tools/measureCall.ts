import { readFileSync } from 'node:fs';

import { makeAnthropicLlmClient } from '../vision/anthropicClient.js';
import { extractFrame } from '../vision/extractFrame.js';
import { redactError } from '../vision/redact.js';

// Direct measurement of called/✓ detection: run the live extractor N times
// against a frame and count how often calledFor matches an expected value.
// Independent of any golden — answers "does it read the check mark" honestly.
//
//   npm run measure-call -- <framePng> <expectedCalledForLowercase> [runs]

const flagValue = (flag: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
};

const run = async (): Promise<void> => {
  const framePath = process.argv[2];
  const expected = process.argv[3]?.toLowerCase();
  const runs = process.argv[4] === undefined || process.argv[4].startsWith('--') ? 20 : Number(process.argv[4]);
  const model = flagValue('--model');
  const recallModel = flagValue('--recall-model');
  const votesFlag = flagValue('--votes');
  const votes = votesFlag === undefined ? undefined : Number(votesFlag);
  if (framePath === undefined || expected === undefined) {
    console.error('Usage: npm run measure-call -- <framePng> <expectedCalledForLowercase> [runs] [--model X] [--votes N]');
    process.exit(1);
  }
  if (process.env.ANTHROPIC_API_KEY === undefined) {
    console.error('ANTHROPIC_API_KEY is not set.');
    process.exit(1);
  }

  console.log(`model=${model ?? 'haiku (default)'} recallModel=${recallModel ?? 'sonnet (default)'} recallVotes=${votes ?? '1 (default)'} runs=${runs}`);
  const png = readFileSync(framePath);
  const client = makeAnthropicLlmClient();
  const deps = {
    client,
    ...(model === undefined ? {} : { model }),
    ...(recallModel === undefined ? {} : { recallModel }),
    ...(votes === undefined ? {} : { recallVotes: votes }),
  };
  let correct = 0;
  const got = new Map<string, number>();

  for (let attempt = 1; attempt <= runs; attempt++) {
    const observed = await extractFrame(png, 0, deps);
    const calledFor = observed[0]?.calledFor ?? [];
    const key = calledFor.length === 0 ? '<none>' : calledFor.map((value) => value.toLowerCase()).sort().join('+');
    got.set(key, (got.get(key) ?? 0) + 1);
    if (key === expected) {
      correct += 1;
      process.stdout.write('.');
    } else {
      process.stdout.write('X');
    }
  }

  console.log(`\n\ncalledFor correct: ${correct}/${runs} (expected "${expected}")`);
  console.log('distribution:');
  Array.from(got.entries())
    .sort((a, b) => b[1] - a[1])
    .forEach(([value, count]) => console.log(`  ${count}×  ${value}`));
};

run().catch((error: unknown) => {
  console.error(redactError(error));
  process.exit(1);
});
