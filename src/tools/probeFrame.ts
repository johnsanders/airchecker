import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import { extractFrame } from '../vision/extractFrame.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { redactError } from '../vision/redact.js';

// One real Messages-API vision call against a single frame, printing the parsed
// air observations. Use it to answer "does the model read this frame correctly?"
// — especially the ticker, whose small vote totals are the open resolution risk.
//
//   ANTHROPIC_API_KEY=... node --env-file-if-exists=.env --import tsx src/tools/probeFrame.ts recordings/reference-frames/ticker_1920.png
//
// Pass --maxwidth N to downscale before sending (defaults to no resize) — set it
// to 1432 to simulate the API's ~1.15MP auto-shrink and see if the ticker survives.

const run = async (): Promise<void> => {
	const framePath = process.argv[2];
	if (framePath === undefined) {
		console.error(
			'Usage: node --env-file-if-exists=.env --import tsx src/tools/probeFrame.ts <framePng> [--maxwidth N]',
		);
		process.exit(1);
	}
	const missingKeys = missingLiveKeys();
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set — live mode requires both.`);
		process.exit(1);
	}

	const maxWidthFlag = process.argv.indexOf('--maxwidth');
	const maxWidth = maxWidthFlag === -1 ? undefined : Number(process.argv[maxWidthFlag + 1]);

	const original = readFileSync(framePath);
	const png =
		maxWidth === undefined
			? original
			: await sharp(original)
					.resize({ width: maxWidth, withoutEnlargement: true })
					.png()
					.toBuffer();
	const meta = await sharp(png).metadata();
	console.log(`frame ${framePath} → sending ${meta.width}×${meta.height}`);

	const client = makeLiveLlmClient();
	const observations = await extractFrame(png, Date.now(), { client });

	console.log(`\n${observations.length} template(s) detected:\n`);
	observations.forEach((observation) => {
		const pctIn = observation.missingFields?.includes('pct_in')
			? 'MISSING'
			: `${observation.pctInIsMinimum ? '>' : ''}${observation.pctIn}`;
		console.log(
			`  [${observation.templateId}] raceKey=${observation.raceKey} pctIn=${pctIn} calledFor=${observation.calledFor.join('+') || '—'}`,
		);
		observation.candidates.forEach((candidate) => {
			console.log(
				`    ${candidate.party} ${candidate.name} — ${candidate.pct}% / ${candidate.votes.toLocaleString()}`,
			);
		});
	});
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
