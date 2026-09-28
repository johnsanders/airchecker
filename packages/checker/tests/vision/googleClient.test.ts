import { describe, expect, it } from 'vitest';

import type { LlmRequest } from '../../src/vision/llmClient.js';

import { makeGoogleLlmClient } from '../../src/vision/googleClient.js';

type Captured = { body: Record<string, unknown>; headers: Record<string, string>; url: string };

// The shape a live probe returned on 2026-09-26 (thought signature elided).
const interaction = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	model: 'gemini-3.8-flash',
	object: 'interaction',
	status: 'requires_action',
	steps: [
		{ signature: 'opaque', type: 'thought' },
		{
			arguments: { templates: [] },
			id: 'call_1',
			name: 'report_templates',
			type: 'function_call',
		},
	],
	usage: { total_input_tokens: 1189, total_output_tokens: 36, total_thought_tokens: 157 },
	...overrides,
});

const fakeFetch = (
	reply: Record<string, unknown>,
	status = 200,
): { captured: Captured[]; fetchImpl: typeof fetch } => {
	const captured: Captured[] = [];
	const fetchImpl: typeof fetch = async (input, init) => {
		captured.push({
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
			headers: (init?.headers ?? {}) as Record<string, string>,
			url: String(input),
		});
		return new Response(JSON.stringify(reply), { status });
	};
	return { captured, fetchImpl };
};

const request: LlmRequest = {
	image: { base64: 'AAAA', mediaType: 'image/png' },
	model: 'gemini-3.8-flash',
	prompt: 'read the frame',
	tool: {
		description: 'report',
		inputSchema: { properties: {}, type: 'object' },
		name: 'report_templates',
	},
	toolChoice: 'report_templates',
};

describe('makeGoogleLlmClient', () => {
	it('sends an Interactions request with the inline image, the forced function tool, low thinking and store:false', async () => {
		const fake = fakeFetch(interaction());
		const client = makeGoogleLlmClient({ apiKey: 'g-key', fetchImpl: fake.fetchImpl });
		const response = await client.call(request);

		const sent = fake.captured[0];
		expect(sent?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
		expect(sent?.headers['x-goog-api-key']).toBe('g-key');
		expect(sent?.body.model).toBe('gemini-3.8-flash');
		expect(sent?.body.store).toBe(false);
		expect(sent?.body.input).toEqual([
			{ data: 'AAAA', mime_type: 'image/png', type: 'image' },
			{ text: 'read the frame', type: 'text' },
		]);
		expect(sent?.body.tools).toEqual([
			{
				description: 'report',
				name: 'report_templates',
				parameters: { properties: {}, type: 'object' },
				type: 'function',
			},
		]);
		expect(sent?.body.generation_config).toEqual({
			max_output_tokens: 4096,
			thinking_level: 'low',
			tool_choice: { allowed_tools: { mode: 'any', tools: ['report_templates'] } },
		});

		expect(response.body).toEqual({ templates: [] });
		expect(response.model).toBe('gemini-3.8-flash');
		expect(response.usage).toEqual({ inputTokens: 1189, outputTokens: 193 });
	});

	it('honours an explicit thinking level and omits it for "default"', async () => {
		const high = fakeFetch(interaction());
		await makeGoogleLlmClient({
			apiKey: 'g-key',
			fetchImpl: high.fetchImpl,
			thinkingLevel: 'high',
		}).call(request);
		expect(
			(high.captured[0]?.body.generation_config as Record<string, unknown>).thinking_level,
		).toBe('high');

		const provider = fakeFetch(interaction());
		await makeGoogleLlmClient({
			apiKey: 'g-key',
			fetchImpl: provider.fetchImpl,
			thinkingLevel: 'default',
		}).call(request);
		expect(
			(provider.captured[0]?.body.generation_config as Record<string, unknown>).thinking_level,
		).toBeUndefined();
	});

	it('returns a null body when no function_call step came back', async () => {
		const fake = fakeFetch(interaction({ steps: [{ type: 'model_output' }] }));
		const response = await makeGoogleLlmClient({ apiKey: 'g-key', fetchImpl: fake.fetchImpl }).call(
			request,
		);
		expect(response.body).toBeNull();
	});

	it('throws on an HTTP error, retrying only transient ones', async () => {
		let calls = 0;
		const flaky: typeof fetch = async () => {
			calls += 1;
			return calls === 1
				? new Response('busy', { status: 503 })
				: new Response(JSON.stringify(interaction()), { status: 200 });
		};
		const ok = await makeGoogleLlmClient({
			apiKey: 'g-key',
			fetchImpl: flaky,
			retryDelaysMs: [0],
		}).call(request);
		expect(ok.body).toEqual({ templates: [] });
		expect(calls).toBe(2);

		const depleted = fakeFetch({ error: { code: 402, message: 'credits depleted' } }, 402);
		await expect(
			makeGoogleLlmClient({
				apiKey: 'g-key',
				fetchImpl: depleted.fetchImpl,
				retryDelaysMs: [0],
			}).call(request),
		).rejects.toThrow(/HTTP 402/);
		expect(depleted.captured).toHaveLength(1);
	});

	it('refuses to start without a key', () => {
		expect(() => makeGoogleLlmClient({ apiKey: '' })).toThrow(/GEMINI_API_KEY/);
	});
});
