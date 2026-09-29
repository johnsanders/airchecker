import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

import makeRecorder from '../replay/recorder.js';
import { extractFrame } from '../vision/extractFrame.js';
import { makeLiveLlmClient, missingLiveKeys } from '../vision/liveLlmClient.js';
import { makeRecordingLlmClient } from '../vision/llmClient.js';
import { redactError } from '../vision/redact.js';

// Dry-runs the whole air pipeline against a recording instead of a broadcast:
// samples the video at the capture cadence with ffmpeg, runs the extractor over
// every frame with the recording LLM client, and writes a normal
// session (frames, LLM calls, observations) under recordings/. The session can
// then be frozen (`freeze-session`), mined for frame goldens
// (`capture-golden --from-session`), or replayed — all with no API key.
//
//   node --env-file-if-exists=../../.env --import tsx src/tools/importVideo.ts <video> [fps]      (default fps 0.2 = one frame per 5 s)
//
// Observations are stamped on a synthetic timeline starting now, one frame per
// 1/fps seconds, so replay batching by observedAt reproduces the cadence.

const run = async (): Promise<void> => {
	const videoPath = process.argv[2];
	const fps = Number(process.argv[3] ?? '0.2');
	if (videoPath === undefined || !Number.isFinite(fps) || fps <= 0) {
		console.error(
			'Usage: node --env-file-if-exists=../../.env --import tsx src/tools/importVideo.ts <video> [fps]',
		);
		process.exit(1);
	}
	const missingKeys = missingLiveKeys();
	if (missingKeys.length > 0) {
		console.error(`${missingKeys.join(', ')} not set — the import makes live vision calls.`);
		process.exit(1);
	}

	const stem = basename(videoPath).replace(/\.[^.]+$/, '');
	const sessionId = `video-${stem}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	const recorder = makeRecorder({
		baseDir: 'recordings',
		meta: { fps, kind: 'video-import', video: videoPath },
		sessionId,
	});
	const client = makeRecordingLlmClient(makeLiveLlmClient(), recorder);

	const sampleDir = join('recordings', sessionId, 'samples');
	mkdirSync(sampleDir, { recursive: true });
	console.log(`[import] sampling ${videoPath} at ${fps} fps → ${sampleDir}`);
	execFileSync(
		'ffmpeg',
		['-v', 'error', '-y', '-i', videoPath, '-vf', `fps=${fps}`, join(sampleDir, '%05d.png')],
		{ stdio: 'inherit' },
	);
	const samples = readdirSync(sampleDir)
		.filter((file) => file.endsWith('.png'))
		.sort();
	const stepMs = Math.round(1000 / fps);
	const startedAt = Date.now();
	console.log(`[import] ${samples.length} frames, one per ${stepMs} ms — session ${sessionId}`);

	const totals = { calls: 0, frames: 0, observations: 0 };
	const byTemplate = new Map<string, number>();
	await samples.reduce(
		(chain, file, index) =>
			chain.then(async () => {
				const png = readFileSync(join(sampleDir, file));
				const observedAt = startedAt + index * stepMs;
				recorder.recordFrame({ png, ts: observedAt });
				const before = totals.calls;
				const counting = {
					call: async (request: Parameters<typeof client.call>[0]) => {
						totals.calls += 1;
						return client.call(request);
					},
				};
				const observations = await extractFrame(png, observedAt, { client: counting });
				observations.forEach(recorder.recordObservation);
				totals.frames += 1;
				totals.observations += observations.length;
				observations.forEach((observation) => {
					const id = observation.templateId ?? '?';
					byTemplate.set(id, (byTemplate.get(id) ?? 0) + 1);
				});
				const summary = observations
					.map(
						(observation) =>
							`${observation.templateId}:${observation.raceKey}${observation.calledFor.length > 0 ? ' ✓' : ''}`,
					)
					.join(' | ');
				console.log(
					`  t=${String((index / fps).toFixed(0)).padStart(4)}s ${file} calls=${totals.calls - before} ${summary || '(none)'}`,
				);
			}),
		Promise.resolve(),
	);
	recorder.close();
	// The sampled PNGs are already stored content-addressed under frames/.
	rmSync(sampleDir, { force: true, recursive: true });

	const perTemplate = Array.from(byTemplate.entries())
		.map(([id, count]) => `${id}=${count}`)
		.join(', ');
	console.log(
		`[import] done: ${totals.frames} frames, ${totals.observations} observations (${perTemplate}), ${totals.calls} LLM calls → recordings/${sessionId}.sqlite`,
	);
	console.log(
		`[import] freeze it:  node --import tsx src/tools/freezeSessionGolden.ts ${sessionId} <goldenName>`,
	);
};

run().catch((error: unknown) => {
	console.error(redactError(error));
	process.exit(1);
});
