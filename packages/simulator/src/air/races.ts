import { readFileSync } from 'node:fs';
import { z } from 'zod';

// races.json: the simulated air feed's races, written by src/tools/buildRaces.ts.

const candidateSchema = z.object({ first: z.string(), last: z.string(), party: z.string() });

const raceSchema = z.object({
	candidates: z.array(candidateSchema),
	ddhqRaceId: z.number().nullable(),
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
