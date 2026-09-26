import { createHash } from 'node:crypto';

import type { Recorder } from '../replay/recorder.js';

export type LlmClient = {
	call: (request: LlmRequest) => Promise<LlmResponse>;
};

export type LlmImage = {
	base64: string;
	mediaType: 'image/jpeg' | 'image/png';
};

export type LlmRequest = {
	extra?: Record<string, unknown>;
	frameHash?: string;
	image?: LlmImage;
	model: string;
	prompt: string;
	tool?: LlmTool;
	toolChoice?: string;
};

export type LlmResponse = {
	body: unknown;
	model: string;
	usage?: LlmUsage;
};

export type LlmTool = {
	description: string;
	inputSchema: Record<string, unknown>;
	name: string;
};

// What the call billed, when the backend reports it. OpenRouter prices each
// response in USD; Anthropic reports tokens only.
export type LlmUsage = {
	costUsd?: number;
	inputTokens: number;
	outputTokens: number;
};

// Keyed on what determines the response shape — NOT the image (that's keyed
// separately by frameHash at lookup, since the frame is content-addressed).
const hashPrompt = (request: LlmRequest): string => {
	const canonical = JSON.stringify({
		extra: request.extra ?? null,
		model: request.model,
		prompt: request.prompt,
		tool: request.tool ?? null,
		toolChoice: request.toolChoice ?? null,
	});
	return createHash('sha256').update(canonical).digest('hex');
};

const makeStubLlmClient = (recorder: Recorder): LlmClient => ({
	call: async (request) => {
		const promptHash = hashPrompt(request);
		const hit = recorder.lookupLlm(request.frameHash ?? null, promptHash);
		if (hit === undefined) {
			throw new Error(
				`stub LLM miss: model=${request.model} frameHash=${request.frameHash ?? '<none>'} promptHash=${promptHash}`,
			);
		}
		return { body: hit.response, model: hit.model };
	},
});

// The base64 image dominates recording size (~2.3MB per vision call, ~240MB/hour of
// session DB) and is never read back — replay keys on (frame_hash, prompt_hash), full
// frames are content-addressed on disk, and pass-2 crops regenerate deterministically.
const stripImagePayload = (request: LlmRequest): LlmRequest =>
	request.image === undefined
		? request
		: { ...request, image: { ...request.image, base64: '<stripped>' } };

const makeRecordingLlmClient = (underlying: LlmClient, recorder: Recorder): LlmClient => ({
	call: async (request) => {
		const promptHash = hashPrompt(request);
		const response = await underlying.call(request);
		recorder.recordLlmCall({
			frameHash: request.frameHash ?? null,
			model: response.model,
			promptHash,
			request: stripImagePayload(request),
			response: response.body,
			ts: Date.now(),
		});
		return response;
	},
});

export { hashPrompt, makeRecordingLlmClient, makeStubLlmClient };
