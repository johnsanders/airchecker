import { readFileSync } from 'node:fs';
import { z } from 'zod';

// races.json: the simulated air feed's races, written by src/tools/buildRaces.ts.

const candidateSchema = z.object({
	candId: z.number(), // DDHQ cand_id; the mirrors use it as each source's candidate id
	first: z.string(),
	incumbent: z.boolean(),
	last: z.string(),
	party: z.string(), // the letter the checker derives from partyName
	partyName: z.string(),
});

const raceSchema = z.object({
	candidates: z.array(candidateSchema),
	// DDHQ's own fields for the race, which the mirrors serve back as they are.
	ddhq: z.object({
		level: z.string(),
		name: z.string(),
		office: z.string(),
		raceId: z.number(),
		year: z.number(),
	}),
	district: z.string(),
	graphics: z.array(z.enum(['fs', 'l3'])),
	key: z.string(),
	office: z.string(),
	state: z.string(),
	stateName: z.string(),
});

export type Race = z.infer<typeof raceSchema>;

export type RaceCandidate = z.infer<typeof candidateSchema>;

export const loadRaces = (file: string): Race[] =>
	z.array(raceSchema).parse(JSON.parse(readFileSync(file, 'utf8')));
