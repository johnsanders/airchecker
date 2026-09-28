import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

// Persisted, editable-from-the-web settings: what the recorder polls (the DDHQ query
// list, host and sample interval) and what a simulated night's numbers come from.
// Kept in a small JSON file so they survive restarts.

// 'invented' makes up a night's numbers (night.ts); 'ddhqIntegration' pulls them from
// DDHQ's integration host instead (liveResults.ts), for testing against DDHQ during
// its testing windows.
export type AirSource = 'ddhqIntegration' | 'invented';

export type DdhqEnvironment = 'integration' | 'production';

export type Settings = {
	airSource: AirSource;
	environment: DdhqEnvironment;
	intervalSeconds: number;
	queries: string[];
};

// Below this a tick's paging can outrun the next one; above it nothing moves on air.
export const MIN_INTERVAL_SECONDS = 5;
export const MAX_INTERVAL_SECONDS = 3600;

export type SettingsStore = {
	get: () => Settings;
	set: (next: Settings) => Settings;
};

const settingsSchema = z.object({
	// Settings files from before airSource existed lack it.
	airSource: z.enum(['ddhqIntegration', 'invented']).default('invented'),
	environment: z.enum(['integration', 'production']),
	// Settings files from before the interval was editable lack it.
	intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS).default(60),
	queries: z.array(z.string()),
});

const DEFAULTS: Settings = {
	airSource: 'invented',
	environment: 'production',
	intervalSeconds: 60,
	queries: [],
};

export const ddhqBaseUrl = (environment: DdhqEnvironment): string =>
	environment === 'integration'
		? 'https://resultsapi-integration.decisiondeskhq.com'
		: (process.env.DDHQ_BASE_URL ?? 'https://resultsapi.decisiondeskhq.com');

export const makeSettingsStore = (file: string): SettingsStore => {
	let current = existsSync(file)
		? settingsSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
		: DEFAULTS;
	return {
		get: () => ({ ...current, queries: [...current.queries] }),
		set: (next) => {
			current = { ...next, queries: [...next.queries] };
			writeFileSync(file, `${JSON.stringify(current, null, '\t')}\n`);
			return { ...current, queries: [...current.queries] };
		},
	};
};
