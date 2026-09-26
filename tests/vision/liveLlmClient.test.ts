import { describe, expect, it } from 'vitest';

import type { LlmClient, LlmRequest } from '../../src/vision/llmClient.js';

import { backendFor, makeLiveLlmClient, missingLiveKeys } from '../../src/vision/liveLlmClient.js';

const tagged = (tag: string): LlmClient => ({
	call: async (request) => ({ body: tag, model: request.model }),
});

const requestFor = (model: string): LlmRequest => ({ model, prompt: 'x' });

describe('makeLiveLlmClient', () => {
	it('routes gemini-* IDs to Google, vendor/model IDs to OpenRouter, and the rest to Anthropic', async () => {
		const client = makeLiveLlmClient({
			anthropic: tagged('anthropic'),
			google: tagged('google'),
			openRouter: tagged('openrouter'),
		});
		expect((await client.call(requestFor('claude-haiku-4-5'))).body).toBe('anthropic');
		expect((await client.call(requestFor('gemini-3.8-flash'))).body).toBe('google');
		expect((await client.call(requestFor('google/gemini-3.8-flash'))).body).toBe('openrouter');
		expect((await client.call(requestFor('deepseek/deepseek-v4.1-flash'))).body).toBe('openrouter');
	});

	it('picks the backend from the model ID', () => {
		expect(backendFor('claude-sonnet-4-6')).toBe('anthropic');
		expect(backendFor('gemini-3.8-flash')).toBe('google');
		expect(backendFor('openai/gpt-5.4-mini')).toBe('openrouter');
	});

	it('names the keys the requested models need that are missing', () => {
		const saved = { ...process.env };
		try {
			process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
			delete process.env.OPENROUTER_API_KEY;
			delete process.env.GEMINI_API_KEY;
			expect(missingLiveKeys(['claude-haiku-4-5', 'gemini-3.8-flash'])).toEqual(['GEMINI_API_KEY']);
			expect(missingLiveKeys(['claude-haiku-4-5', 'google/gemini-3.8-flash'])).toEqual([
				'OPENROUTER_API_KEY',
			]);
			expect(missingLiveKeys(['claude-haiku-4-5', 'claude-sonnet-4-6'])).toEqual([]);
		} finally {
			process.env = saved;
		}
	});
});
