import { readFileSync } from 'node:fs';

import { DEFAULT_MODEL, extractFrame } from '../vision/extractFrame.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { redactError } from '../vision/redact.js';
import { formatUsage, makeUsageMeter } from './usageMeter.js';

// Direct measurement of called/✓ detection: run the live extractor N times
// against a frame and count how often calledFor matches an expected value.
// Independent of any golden — answers "does it read the check mark" honestly.
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/measureCall.ts <framePng> <expectedCalledForLowercase> [runs] [--template <id>]
//     --template picks which observation to score on a multi-surface frame (default: first)
//     --model takes a Google, Anthropic or OpenRouter (vendor/model) ID
//     --reasoning sets the reasoning effort (none | minimal | low | medium | high)

const flagValue = (flag: string): string | undefined => {
	const index = process.argv.indexOf(flag);
	return index === -1 ? undefined : process.argv[index + 1];
};

const run = async (): Promise<void> => {
	const framePath = process.argv[2];
	const expected = process.argv[3]?.toLowerCase();
	const runs =
		process.argv[4] === undefined || process.argv[4].startsWith('--')
			? 20
			: Number(process.argv[4]);
	const model = flagValue('--model');
	const template = flagValue('--template');
	const reasoning = flagValue('--reasoning');
	if (framePath === undefined || expected === undefined) {
		console.error(
			'Usage: node --env-file-if-exists=../../.env --import tsx src/tools/measureCall.ts <framePng> <expectedCalledForLowercase> [runs] [--template <id>] [--model X] [--reasoning E]',
		);
		process.exit(1);
	}
	const missingKeys = missingLiveKeys([model ?? DEFAULT_MODEL]);
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set.`);
		process.exit(1);
	}

	console.log(
		`model=${model ?? DEFAULT_MODEL} reasoning=${reasoning ?? 'low (client default)'} runs=${runs}`,
	);
	const png = readFileSync(framePath);
	const meter = makeUsageMeter(
		makeLiveLlmClient(reasoning === undefined ? {} : { reasoningEffort: reasoning }),
	);
	const deps = {
		client: meter.client,
		...(model === undefined ? {} : { model }),
	};
	let correct = 0;
	const got = new Map<string, number>();

	for (let attempt = 1; attempt <= runs; attempt++) {
		let key: string;
		try {
			const observed = await extractFrame(png, 0, deps);
			const target =
				template === undefined
					? observed[0]
					: observed.find((observation) => observation.templateId === template);
			const calledFor = target?.calledFor ?? [];
			key =
				calledFor.length === 0
					? '<none>'
					: calledFor
							.map((value) => value.toLowerCase())
							.sort()
							.join('+');
		} catch (error) {
			key = `error: ${redactError(error).split('\n')[0] ?? ''}`;
		}
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
	console.log('usage:');
	formatUsage(meter.totals(), runs).forEach((line) => console.log(`  ${line}`));
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
