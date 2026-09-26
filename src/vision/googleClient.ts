import { z } from 'zod';

import type { LlmClient, LlmRequest } from './llmClient.js';

import { DEFAULT_RETRY_DELAYS_MS, postJsonWithRetry } from './retryingFetch.js';

// Google's Interactions API called directly — no router and no prepaid router
// balance on the air path. The frame goes in as an inline image part, the
// reporting tool as a function tool that tool_choice forces, and store:false
// keeps the interaction out of Google's server-side history. Shape verified
// with a live probe on 2026-09-26: the reply is a `steps` array holding a
// `thought` and a `function_call` whose `arguments` is already an object, and
// `usage` carries input / output / thought token counts. Thought tokens are
// billed as output, so they are folded into outputTokens.
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_THINKING_LEVEL = 'low';

const interactionSchema = z.object({
	error: z.object({ message: z.string() }).optional(),
	model: z.string().optional(),
	steps: z
		.array(
			z.object({
				arguments: z.unknown().optional(),
				name: z.string().optional(),
				type: z.string(),
			}),
		)
		.optional(),
	usage: z
		.object({
			total_input_tokens: z.number(),
			total_output_tokens: z.number(),
			total_thought_tokens: z.number().optional(),
		})
		.optional(),
});

export type GoogleLlmClientOptions = {
	apiKey?: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	maxTokens?: number;
	retryDelaysMs?: readonly number[];
	// Gemini 3's thinking_level ('minimal' | 'low' | 'medium' | 'high'). Defaults
	// to 'low' — what the crop read was measured at (~160 thought tokens per
	// crop). 'default' sends nothing and leaves Google's own setting in place.
	thinkingLevel?: string;
};

const buildBody = (
	request: LlmRequest,
	options: GoogleLlmClientOptions,
): Record<string, unknown> => {
	const thinkingLevel = options.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
	const input: unknown[] = [];
	if (request.image !== undefined)
		input.push({ data: request.image.base64, mime_type: request.image.mediaType, type: 'image' });
	input.push({ text: request.prompt, type: 'text' });
	return {
		generation_config: {
			max_output_tokens: options.maxTokens ?? 4096,
			...(thinkingLevel === 'default' ? {} : { thinking_level: thinkingLevel }),
			...(request.toolChoice === undefined
				? {}
				: { tool_choice: { allowed_tools: { mode: 'any', tools: [request.toolChoice] } } }),
		},
		input,
		model: request.model,
		store: false,
		...(request.tool === undefined
			? {}
			: {
					tools: [
						{
							description: request.tool.description,
							name: request.tool.name,
							parameters: request.tool.inputSchema,
							type: 'function',
						},
					],
				}),
	};
};

export const makeGoogleLlmClient = (options: GoogleLlmClientOptions = {}): LlmClient => {
	const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
	if (apiKey === undefined || apiKey.length === 0)
		throw new Error('GEMINI_API_KEY is not set — required for any gemini-* model ID.');
	const fetchImpl = options.fetchImpl ?? fetch;
	const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
	const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
	return {
		call: async (request) => {
			const response = await postJsonWithRetry({
				body: JSON.stringify(buildBody(request, options)),
				fetchImpl,
				headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
				label: `Google ${request.model}`,
				retryDelaysMs,
				url: `${baseUrl}/interactions`,
			});
			const parsed = interactionSchema.parse(await response.json());
			if (parsed.error !== undefined)
				throw new Error(`Google error for ${request.model}: ${parsed.error.message}`);
			const call = parsed.steps?.find((step) => step.type === 'function_call');
			return {
				body: call?.arguments ?? null,
				model: parsed.model ?? request.model,
				...(parsed.usage === undefined
					? {}
					: {
							usage: {
								inputTokens: parsed.usage.total_input_tokens,
								outputTokens:
									parsed.usage.total_output_tokens + (parsed.usage.total_thought_tokens ?? 0),
							},
						}),
			};
		},
	};
};
