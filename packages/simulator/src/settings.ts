import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';

// Persisted, editable-from-the-web settings: what the recorder polls (the DDHQ query
// list and sample interval) and what a simulated night's numbers come from.
// Kept in a small JSON file so they survive restarts.

// How a simulated night paces its graphics (schedule.ts). The ticker moves to its next race
// every tickerSeconds. Over it an overlay holds overlaySeconds, then gapSeconds pass with
// none; the overlays run fsCount FS then l3Count L3, over and over. Both counts 0 is ticker
// only. Read when a night or a recording goes on air, so a change shows from the next one:
// changing what airs mid-run would rewrite what /api/air/aired says aired earlier in it.
export type AirSchedule = z.infer<typeof airScheduleSchema>;

// 'invented' makes up a night's numbers (night.ts); 'ddhqIntegration' pulls them from
// DDHQ's integration host instead (liveResults.ts), for testing against DDHQ during
// its testing windows.
export type AirSource = 'ddhqIntegration' | 'invented';

export const airScheduleSchema = z.object({
	fsCount: z.number().int().min(0).max(20),
	gapSeconds: z.number().int().min(0).max(600),
	l3Count: z.number().int().min(0).max(20),
	overlaySeconds: z.number().int().min(2).max(120),
	tickerSeconds: z.number().int().min(2).max(60),
});

export const DEFAULT_AIR_SCHEDULE: AirSchedule = {
	fsCount: 1,
	gapSeconds: 15,
	l3Count: 1,
	overlaySeconds: 10,
	tickerSeconds: 8,
};

export type Settings = {
	airSchedule: AirSchedule;
	airSource: AirSource;
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
	// Settings files from before the schedule was editable lack it.
	airSchedule: airScheduleSchema.default(DEFAULT_AIR_SCHEDULE),
	// Settings files from before airSource existed lack it.
	airSource: z.enum(['ddhqIntegration', 'invented']).default('invented'),
	// Settings files from before the interval was editable lack it.
	intervalSeconds: z.number().int().min(MIN_INTERVAL_SECONDS).max(MAX_INTERVAL_SECONDS).default(60),
	queries: z.array(z.string()),
});

const DEFAULTS: Settings = {
	airSchedule: DEFAULT_AIR_SCHEDULE,
	airSource: 'invented',
	intervalSeconds: 60,
	queries: [],
};

// DDHQ's integration host, where its test runs are served. It is the only DDHQ the
// simulator records or pulls a night from: production is never recorded.
export const DDHQ_INTEGRATION_URL = 'https://resultsapi-integration.decisiondeskhq.com';

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
