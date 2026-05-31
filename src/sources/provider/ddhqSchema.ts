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

const precinctsSchema = z.object({
	percent: z.number(),
	reporting: z.number(),
	total: z.number(),
});

const toplineSchema = z.object({
	call_times: z.array(z.unknown()),
	called_candidates: z.array(z.number()),
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
