import type { LlmClient } from '../vision/llmClient.js';

// Wraps a client to total what each model billed. OpenRouter prices each
// response itself; the direct backends report tokens, priced here from the
// public lists (USD per million tokens, 2026-09-26; Gemini thought tokens are
// already folded into outputTokens by the client).
const LIST_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
	'claude-haiku-4-5': { input: 1, output: 5 },
	'claude-opus-5-5': { input: 4, output: 20 },
	'claude-sonnet-4-6': { input: 3, output: 15 },
	'claude-sonnet-5': { input: 2, output: 10 },
	'gemini-3.8-flash': { input: 0.75, output: 3.75 },
};

const listCost = (model: string, inputTokens: number, outputTokens: number): number | undefined => {
	const entry = Object.entries(LIST_USD_PER_MTOK).find(([prefix]) => model.startsWith(prefix));
	return entry === undefined
		? undefined
		: (inputTokens * entry[1].input + outputTokens * entry[1].output) / 1e6;
};

export type ModelUsageTotals = {
	calls: number;
	costUsd: number | undefined;
	inputTokens: number;
	model: string;
	outputTokens: number;
};

export type UsageMeter = {
	client: LlmClient;
	totals: () => ModelUsageTotals[];
};

export const makeUsageMeter = (underlying: LlmClient): UsageMeter => {
	const byModel = new Map<string, ModelUsageTotals>();
	return {
		client: {
			call: async (request) => {
				const response = await underlying.call(request);
				const usage = response.usage;
				if (usage === undefined) return response;
				const current = byModel.get(response.model) ?? {
					calls: 0,
					costUsd: 0,
					inputTokens: 0,
					model: response.model,
					outputTokens: 0,
				};
				const callCost =
					usage.costUsd ?? listCost(response.model, usage.inputTokens, usage.outputTokens);
				byModel.set(response.model, {
					calls: current.calls + 1,
					costUsd:
						current.costUsd === undefined || callCost === undefined
							? undefined
							: current.costUsd + callCost,
					inputTokens: current.inputTokens + usage.inputTokens,
					model: response.model,
					outputTokens: current.outputTokens + usage.outputTokens,
				});
				return response;
			},
		},
		totals: () => Array.from(byModel.values()),
	};
};

// One line per model plus a total priced per frame and per broadcast hour at
// the 5 s capture cadence (720 frames), when every model reported a cost.
export const formatUsage = (totals: ModelUsageTotals[], frames: number): string[] => {
	const lines = totals.map(
		(entry) =>
			`${entry.model}: ${entry.calls} calls, ${entry.inputTokens} in / ${entry.outputTokens} out tokens${
				entry.costUsd === undefined ? '' : `, $${entry.costUsd.toFixed(4)}`
			}`,
	);
	const priced = totals.length > 0 && totals.every((entry) => entry.costUsd !== undefined);
	if (priced && frames > 0) {
		const total = totals.reduce((sum, entry) => sum + (entry.costUsd ?? 0), 0);
		lines.push(
			`total $${total.toFixed(4)} — $${(total / frames).toFixed(4)} per frame, ≈ $${((total / frames) * 720).toFixed(2)} per broadcast hour at 5 s cadence`,
		);
	}
	return lines;
};
