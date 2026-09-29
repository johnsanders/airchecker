import type { LlmClient } from './llmClient.js';

import { makeAnthropicLlmClient } from './anthropicClient.js';
import { DEFAULT_MODEL } from './extractFrame.js';
import { makeGoogleLlmClient } from './googleClient.js';
import { makeOpenRouterLlmClient } from './openRouterClient.js';

// One client for every live call; the model ID picks the backend. Google's
// native IDs start with `gemini-` and go straight to Google; OpenRouter's are
// `vendor/model` (the slash) and go through the router — same Gemini weights,
// useful for trials of other vendors; anything else is Anthropic. Each backend
// is built on first use, so a setup only needs the keys for the models it
// actually asks for.
export type LiveBackend = 'anthropic' | 'google' | 'openrouter';

export const backendFor = (model: string): LiveBackend =>
	model.startsWith('gemini-') ? 'google' : model.includes('/') ? 'openrouter' : 'anthropic';

const KEY_FOR: Record<LiveBackend, string> = {
	anthropic: 'ANTHROPIC_API_KEY',
	google: 'GEMINI_API_KEY',
	openrouter: 'OPENROUTER_API_KEY',
};

// The env var names the given models need that are not set. Defaults to the
// model the extractor uses out of the box.
export const missingLiveKeys = (models: readonly string[] = [DEFAULT_MODEL]): string[] =>
	Array.from(new Set(models.map((model) => KEY_FOR[backendFor(model)]))).filter((name) => {
		const value = process.env[name];
		return value === undefined || value.length === 0;
	});

export type LiveLlmClientOptions = {
	anthropic?: LlmClient;
	google?: LlmClient;
	openRouter?: LlmClient;
	// Reasoning effort / thinking level for the non-Anthropic backends
	// ('minimal' | 'low' | 'medium' | 'high' | 'default'); unset means 'low'.
	reasoningEffort?: string;
};

export const makeLiveLlmClient = (options: LiveLlmClientOptions = {}): LlmClient => {
	let anthropic = options.anthropic;
	let google = options.google;
	let openRouter = options.openRouter;
	const effort = options.reasoningEffort;
	return {
		call: (request) => {
			const backend = backendFor(request.model);
			if (backend === 'google') {
				google ??= makeGoogleLlmClient(effort === undefined ? {} : { thinkingLevel: effort });
				return google.call(request);
			}
			if (backend === 'openrouter') {
				openRouter ??= makeOpenRouterLlmClient(
					effort === undefined ? {} : { reasoningEffort: effort },
				);
				return openRouter.call(request);
			}
			anthropic ??= makeAnthropicLlmClient();
			return anthropic.call(request);
		},
	};
};
