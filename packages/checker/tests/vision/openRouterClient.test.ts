import { describe, expect, it } from 'vitest';

import type { LlmRequest } from '../../src/vision/llmClient.js';

import { makeOpenRouterLlmClient } from '../../src/vision/openRouterClient.js';

type Captured = { body: Record<string, unknown>; headers: Record<string, string>; url: string };

const completion = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
	choices: [
		{
			message: {
				tool_calls: [
					{ function: { arguments: JSON.stringify({ templates: [] }), name: 'report_templates' } },
				],
			},
		},
	],
	model: 'google/gemini-3.8-flash',
	usage: { completion_tokens: 40, cost: 0.00123, prompt_tokens: 1500 },
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
	model: 'google/gemini-3.8-flash',
	prompt: 'read the frame',
	tool: {
		description: 'report',
		inputSchema: { properties: {}, type: 'object' },
		name: 'report_templates',
	},
	toolChoice: 'report_templates',
};

describe('makeOpenRouterLlmClient', () => {
	it('sends an OpenAI-style chat completion with the image as a data URL and the tool forced', async () => {
		const fake = fakeFetch(completion());
		const client = makeOpenRouterLlmClient({ apiKey: 'test-key', fetchImpl: fake.fetchImpl });
		const response = await client.call(request);

		expect(fake.captured).toHaveLength(1);
		const sent = fake.captured[0];
		expect(sent?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
		expect(sent?.headers.Authorization).toBe('Bearer test-key');
		expect(sent?.body.model).toBe('google/gemini-3.8-flash');
		expect(sent?.body.provider).toEqual({ require_parameters: true });
		expect(sent?.body.reasoning).toEqual({ effort: 'low' });
		expect(sent?.body.messages).toEqual([
			{
				content: [
					{ image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
					{ text: 'read the frame', type: 'text' },
				],
				role: 'user',
			},
		]);
		expect(sent?.body.tools).toEqual([
			{
				function: {
					description: 'report',
					name: 'report_templates',
					parameters: { properties: {}, type: 'object' },
				},
				type: 'function',
			},
		]);
		expect(sent?.body.tool_choice).toEqual({
			function: { name: 'report_templates' },
			type: 'function',
		});

		expect(response.body).toEqual({ templates: [] });
		expect(response.model).toBe('google/gemini-3.8-flash');
		expect(response.usage).toEqual({ costUsd: 0.00123, inputTokens: 1500, outputTokens: 40 });
	});

	it('passes a configured reasoning effort through, and sends nothing for "default"', async () => {
		const high = fakeFetch(completion());
		await makeOpenRouterLlmClient({
			apiKey: 'test-key',
			fetchImpl: high.fetchImpl,
			reasoningEffort: 'high',
		}).call(request);
		expect(high.captured[0]?.body.reasoning).toEqual({ effort: 'high' });

		const provider = fakeFetch(completion());
		await makeOpenRouterLlmClient({
			apiKey: 'test-key',
			fetchImpl: provider.fetchImpl,
			reasoningEffort: 'default',
		}).call(request);
		expect(provider.captured[0]?.body.reasoning).toBeUndefined();
	});

	it('returns a null body when the model answered without calling the tool', async () => {
		const fake = fakeFetch(completion({ choices: [{ message: { content: 'prose' } }] }));
		const client = makeOpenRouterLlmClient({ apiKey: 'test-key', fetchImpl: fake.fetchImpl });
		const response = await client.call(request);
		expect(response.body).toBeNull();
	});

	it('throws on an HTTP error and on an in-body error object', async () => {
		const http = fakeFetch({ error: { message: 'no' } }, 402);
		await expect(
			makeOpenRouterLlmClient({ apiKey: 'test-key', fetchImpl: http.fetchImpl }).call(request),
		).rejects.toThrow(/HTTP 402/);
		const body = fakeFetch({ error: { message: 'provider down' } });
		await expect(
			makeOpenRouterLlmClient({ apiKey: 'test-key', fetchImpl: body.fetchImpl }).call(request),
		).rejects.toThrow(/provider down/);
	});

	it('retries a dropped connection and a 5xx, but not a 4xx', async () => {
		const replies: (() => Promise<Response>)[] = [
			async () => {
				throw new TypeError('fetch failed');
			},
			async () => new Response('upstream', { status: 502 }),
			async () => new Response(JSON.stringify(completion()), { status: 200 }),
		];
		let calls = 0;
		const flaky: typeof fetch = async () => {
			const reply = replies[calls];
			calls += 1;
			if (reply === undefined) throw new Error('too many calls');
			return reply();
		};
		const client = makeOpenRouterLlmClient({
			apiKey: 'test-key',
			fetchImpl: flaky,
			retryDelaysMs: [0, 0],
		});
		expect((await client.call(request)).body).toEqual({ templates: [] });
		expect(calls).toBe(3);

		let badCalls = 0;
		const bad: typeof fetch = async () => {
			badCalls += 1;
			return new Response('nope', { status: 400 });
		};
		await expect(
			makeOpenRouterLlmClient({ apiKey: 'test-key', fetchImpl: bad, retryDelaysMs: [0, 0] }).call(
				request,
			),
		).rejects.toThrow(/HTTP 400/);
		expect(badCalls).toBe(1);
	});

	it('refuses to start without a key', () => {
		expect(() => makeOpenRouterLlmClient({ apiKey: '' })).toThrow(/OPENROUTER_API_KEY/);
	});
});
