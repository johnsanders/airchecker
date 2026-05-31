import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LlmClient, LlmRequest } from '../../src/vision/llmClient.js';

import makeRecorder from '../../src/replay/recorder.js';
import {
	hashPrompt,
	makeRecordingLlmClient,
	makeStubLlmClient,
} from '../../src/vision/llmClient.js';

let baseDir: string;

beforeEach(() => {
	baseDir = mkdtempSync(join(tmpdir(), 'eagle-llm-'));
});

afterEach(() => {
	rmSync(baseDir, { force: true, recursive: true });
});

describe('hashPrompt', () => {
	it('is deterministic for equivalent requests and differs on prompt change', () => {
		const a: LlmRequest = { model: 'm', prompt: 'hello' };
		const b: LlmRequest = { model: 'm', prompt: 'hello' };
		const c: LlmRequest = { model: 'm', prompt: 'goodbye' };
		expect(hashPrompt(a)).toBe(hashPrompt(b));
		expect(hashPrompt(a)).not.toBe(hashPrompt(c));
	});

	it('ignores frameHash (frameHash is keyed separately at lookup)', () => {
		const a: LlmRequest = { frameHash: 'abc', model: 'm', prompt: 'p' };
		const b: LlmRequest = { frameHash: 'xyz', model: 'm', prompt: 'p' };
		expect(hashPrompt(a)).toBe(hashPrompt(b));
	});
});

describe('recording + stub round-trip', () => {
	it('records a call and the stub replays it from the same recorder file', async () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-llm' });

		const underlying: LlmClient = {
			call: async (request) => ({
				body: { echo: request.prompt },
				model: request.model,
			}),
		};
		const recording = makeRecordingLlmClient(underlying, recorder);

		const request: LlmRequest = {
			frameHash: 'frame-1',
			model: 'claude-haiku-4-5',
			prompt: 'detect ticker',
		};
		const live = await recording.call(request);
		expect(live.body).toEqual({ echo: 'detect ticker' });

		const stub = makeStubLlmClient(recorder);
		const replayed = await stub.call(request);
		expect(replayed).toEqual(live);

		recorder.close();
	});

	it('stub throws on a cache miss', async () => {
		const recorder = makeRecorder({ baseDir, sessionId: 'sess-miss' });
		const stub = makeStubLlmClient(recorder);
		await expect(stub.call({ model: 'm', prompt: 'never-seen' })).rejects.toThrow(/stub LLM miss/);
		recorder.close();
	});
});
