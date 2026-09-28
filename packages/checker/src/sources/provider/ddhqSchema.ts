import { z } from 'zod';

const candidateSchema = z.object({
	cand_id: z.number(),
	first_name: z.string().nullable(),
	incumbent: z.boolean(),
	last_name: z.string(),
	middle_name: z.string().nullable(),
	party_id: z.number(),
	party_name: z.string(),
	preferred_name: z.string().nullable(),
	suffix: z.string().nullable(),
});

// percent is null until DDHQ has a precinct count for the race (pre-election
// General races ship total: 0, percent: null).
const precinctsSchema = z.object({
	percent: z.number().nullable(),
	reporting: z.number(),
	total: z.number(),
});

// DDHQ's modeled progress: total_votes as a share of the expected vote (turnout_*),
// revised through the night. This is what "% IN" means for every race in scope.
const estimatedVotesSchema = z.object({
	estimated_votes_high: z.number(),
	estimated_votes_low: z.number(),
	estimated_votes_mid: z.number(),
	turnout_high: z.number(),
	turnout_low: z.number(),
	turnout_mid: z.number(),
});

const toplineSchema = z.object({
	call_times: z.array(z.unknown()),
	called_candidates: z.array(z.number()),
	estimated_votes: estimatedVotesSchema.nullable().optional(),
	precincts: precinctsSchema,
	total_votes: z.number(),
	votes: z.record(z.string(), z.number()),
});

const raceSchema = z.object({
	candidates: z.array(candidateSchema),
	district: z.string().nullable(),
	last_updated: z.string(),
	level: z.string(),
	name: z.string(),
	office: z.string(),
	party: z.string().nullable(),
	party_id: z.number().nullable(),
	race_id: z.number(),
	// 'estimated' | 'precincts' — which progress figure the race reports in.
	reporting_type: z.string().optional(),
	state: z.string(),
	state_name: z.string(),
	topline_results: toplineSchema,
	year: z.number(),
});

const responseSchema = z.object({
	data: z.array(raceSchema),
	next_page_url: z.string().nullable(),
	page: z.number(),
	total: z.number(),
	total_pages: z.number(),
});

export {
	candidateSchema as ddhqCandidateSchema,
	raceSchema as ddhqRaceSchema,
	responseSchema as ddhqResponseSchema,
};

export type DdhqCandidate = z.infer<typeof candidateSchema>;
export type DdhqRace = z.infer<typeof raceSchema>;
export type DdhqResponse = z.infer<typeof responseSchema>;
