import { z } from 'zod';

import type { LlmClient, LlmRequest } from './llmClient.js';

import { DEFAULT_RETRY_DELAYS_MS, DEFAULT_TIMEOUT_MS, postJsonWithRetry } from './retryingFetch.js';

// OpenRouter speaks OpenAI's chat-completions dialect: the frame goes in as a
// data URL, the reporting tool as a function, and tool_choice forces it.
// require_parameters stops OpenRouter routing to a provider that would drop
// tool_choice and answer in prose. Every response carries usage with the cost
// in USD, so a model trial is priced from what was actually billed.
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_REASONING_EFFORT = 'low';

const completionSchema = z.object({
	choices: z
		.array(
			z.object({
				message: z.object({
					tool_calls: z
						.array(z.object({ function: z.object({ arguments: z.string(), name: z.string() }) }))
						.optional(),
				}),
			}),
		)
		.optional(),
	error: z.object({ message: z.string() }).optional(),
	model: z.string().optional(),
	usage: z
		.object({
			completion_tokens: z.number(),
			cost: z.number().optional(),
			prompt_tokens: z.number(),
		})
		.optional(),
});

export type OpenRouterLlmClientOptions = {
	apiKey?: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	maxTokens?: number;
	// OpenRouter's unified reasoning knob ('none' | 'minimal' | 'low' | 'medium' |
	// 'high'). Defaults to 'low' — what the crop read was measured at; Gemini's
	// default spends ~660 thinking tokens per crop for the same reads. 'default'
	// sends nothing and leaves the provider's own setting in place.
	reasoningEffort?: string;
	retryDelaysMs?: readonly number[];
	timeoutMs?: number;
};

const buildBody = (
	request: LlmRequest,
	options: OpenRouterLlmClientOptions,
): Record<string, unknown> => {
	const reasoningEffort = options.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
	const content: unknown[] = [];
	if (request.image !== undefined)
		content.push({
			image_url: { url: `data:${request.image.mediaType};base64,${request.image.base64}` },
			type: 'image_url',
		});
	content.push({ text: request.prompt, type: 'text' });
	return {
		max_tokens: options.maxTokens ?? 4096,
		messages: [{ content, role: 'user' }],
		model: request.model,
		provider: { require_parameters: true },
		...(reasoningEffort === 'default' ? {} : { reasoning: { effort: reasoningEffort } }),
		...(request.tool === undefined
			? {}
			: {
					tools: [
						{
							function: {
								description: request.tool.description,
								name: request.tool.name,
								parameters: request.tool.inputSchema,
							},
							type: 'function',
						},
					],
					...(request.toolChoice === undefined
						? {}
						: { tool_choice: { function: { name: request.toolChoice }, type: 'function' } }),
				}),
	};
};

export const makeOpenRouterLlmClient = (options: OpenRouterLlmClientOptions = {}): LlmClient => {
	const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
	if (apiKey === undefined || apiKey.length === 0)
		throw new Error('OPENROUTER_API_KEY is not set — required for any vendor/model model ID.');
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
	const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
	return {
		call: async (request) => {
			const response = await postJsonWithRetry({
				body: JSON.stringify(buildBody(request, options)),
				fetchImpl,
				headers: {
					Authorization: `Bearer ${apiKey}`,
					'Content-Type': 'application/json',
					'X-Title': 'Eagle Eye',
				},
				label: `OpenRouter ${request.model}`,
				retryDelaysMs,
				timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
				url: `${baseUrl}/chat/completions`,
			});
			const parsed = completionSchema.parse(await response.json());
			if (parsed.error !== undefined)
				throw new Error(`OpenRouter error for ${request.model}: ${parsed.error.message}`);
			const toolCall = parsed.choices?.[0]?.message.tool_calls?.[0];
			const body: unknown = toolCall === undefined ? null : JSON.parse(toolCall.function.arguments);
			return {
				body,
				model: parsed.model ?? request.model,
				...(parsed.usage === undefined
					? {}
					: {
							usage: {
								inputTokens: parsed.usage.prompt_tokens,
								outputTokens: parsed.usage.completion_tokens,
								...(parsed.usage.cost === undefined ? {} : { costUsd: parsed.usage.cost }),
							},
						}),
			};
		},
	};
};
