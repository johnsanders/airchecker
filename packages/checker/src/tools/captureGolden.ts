import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import type { Player } from '../replay/player.js';
import type { Golden } from '../vision/goldenClient.js';
import type { LlmClient } from '../vision/llmClient.js';

import makePlayer from '../replay/player.js';
import { extractFrame } from '../vision/extractFrame.js';
import { makeGoldenClient } from '../vision/goldenClient.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { hashPrompt } from '../vision/llmClient.js';
import { redactError } from '../vision/redact.js';

// Captures a golden: the full two-pass extraction against a frame, recording the
// exact (frameSha256, promptHash, response) tuples the flow produced plus the
// resulting observations, so a stubbed replay can assert against it with no API key.
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts <framePng> <goldenName>
//     live mode: real VLM calls (needs ANTHROPIC_API_KEY + OPENROUTER_API_KEY)
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts --from-session <sessionId> <frameHash> <goldenName>
//     promote an already-recorded session frame: responses come from the session's
//     llm_calls table — zero API cost, no key needed
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts --refreeze <golden.json> [...more]
//     recompute a golden's observations from its own recorded responses — no API —
//     after a deterministic post-processing change (key normalization, merge rules).
//     Prompts must be unchanged; a prompt change means a live re-capture.
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

// Serves recorded responses from the session DB. extractFrame stamps every
// request's frameHash with the sha256 of the image it sends (full frame in pass 1,
// upscaled crop in pass 2) — the same keying the recorder wrote — so the lookup
// needs no image re-hashing.
const makeSessionStubClient = (player: Player): LlmClient => ({
	call: async (request) => {
		const promptHash = hashPrompt(request);
		const hit = player.lookupLlm(request.frameHash ?? null, promptHash);
		if (hit === undefined) {
			throw new Error(
				`session stub miss: frameHash=${request.frameHash ?? '<none>'} promptHash=${promptHash} — the current prompts don't match what the session recorded`,
			);
		}
		return { body: hit.response, model: hit.model };
	},
});

type CaptureMode =
	| { frameHash: string; goldenName: string; kind: 'session'; sessionId: string }
	| { framePath: string; goldenName: string; kind: 'live' }
	| { goldenPaths: string[]; kind: 'refreeze' };

const parseMode = (args: string[]): CaptureMode | undefined => {
	if (args[0] === '--refreeze') {
		const goldenPaths = args.slice(1);
		return goldenPaths.length === 0 ? undefined : { goldenPaths, kind: 'refreeze' };
	}
	if (args[0] === '--from-session') {
		const [, sessionId, frameHash, goldenName] = args;
		if (sessionId === undefined || frameHash === undefined || goldenName === undefined)
			return undefined;
		return { frameHash, goldenName, kind: 'session', sessionId };
	}
	const [framePath, goldenName] = args;
	if (framePath === undefined || goldenName === undefined) return undefined;
	return { framePath, goldenName, kind: 'live' };
};

type GoldenDoc = {
	frame: string;
	goldens: Golden[];
	name: string;
	observations: unknown;
	sourceFrame: string;
};

const refreeze = async (goldenPath: string): Promise<void> => {
	const doc = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenDoc;
	const png = readFileSync(join(dirname(goldenPath), doc.frame));
	const observations = await extractFrame(png, 0, { client: makeGoldenClient(doc.goldens) });
	writeFileSync(goldenPath, `${JSON.stringify({ ...doc, observations }, null, 2)}\n`);
	console.log(`refroze ${doc.name}: ${observations.length} observation(s)`);
};

const run = async (): Promise<void> => {
	const mode = parseMode(process.argv.slice(2));
	if (mode === undefined) {
		console.error(
			[
				'Usage:',
				'  node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts <framePng> <goldenName>',
				'  node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts --from-session <sessionId> <frameHash> <goldenName>',
				'  node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts --refreeze <golden.json> [...more]',
			].join('\n'),
		);
		process.exit(1);
	}
	if (mode.kind === 'refreeze') {
		await mode.goldenPaths.reduce(
			(chain, goldenPath) => chain.then(() => refreeze(goldenPath)),
			Promise.resolve(),
		);
		return;
	}
	const missingKeys = mode.kind === 'live' ? missingLiveKeys() : [];
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set — capturing a live golden makes real calls.`);
		process.exit(1);
	}

	const player =
		mode.kind === 'session'
			? makePlayer({ baseDir: 'recordings', sessionId: mode.sessionId })
			: undefined;
	const framePath =
		mode.kind === 'session'
			? join('recordings', mode.sessionId, 'frames', `${mode.frameHash}.png`)
			: mode.framePath;
	const sourceFrame =
		mode.kind === 'session'
			? join(mode.sessionId, 'frames', `${mode.frameHash}.png`)
			: basename(mode.framePath);
	const goldenName = mode.goldenName;

	const png = readFileSync(framePath);
	const sink: Golden[] = [];
	const underlying = player === undefined ? makeLiveLlmClient() : makeSessionStubClient(player);
	const client = makeCapturingClient(underlying, sink);
	const observations = await extractFrame(png, 0, { client });
	player?.close();

	if (sink.length === 0) throw new Error('no frame request was captured');

	const outDir = 'recordings/goldens';
	mkdirSync(outDir, { recursive: true });
	// Committed reference frames are referenced in place (a relative path from the
	// goldens dir) instead of duplicating megabytes of PNG; anything else — a
	// session frame is gitignored — is copied in so the golden stays self-contained.
	const referenceFramesDir = resolve('recordings', 'reference-frames');
	const isReferenceFrame = resolve(framePath).startsWith(`${referenceFramesDir}/`);
	const frameFile = isReferenceFrame
		? relative(resolve(outDir), resolve(framePath))
		: `${goldenName}.png`;
	if (!isReferenceFrame) copyFileSync(framePath, join(outDir, frameFile));

	const goldenDoc = {
		frame: frameFile,
		goldens: sink,
		name: goldenName,
		observations,
		sourceFrame,
	};
	const outPath = join(outDir, `${goldenName}.golden.json`);
	writeFileSync(outPath, `${JSON.stringify(goldenDoc, null, 2)}\n`);

	console.log(`captured ${observations.length} observation(s) → ${outPath}`);
	observations.forEach((observation) => {
		console.log(
			`  [${observation.templateId}] ${observation.raceKey} — ${observation.candidates.length} candidates`,
		);
	});
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
