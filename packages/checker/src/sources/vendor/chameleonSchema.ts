import { z } from 'zod';

const partySchema = z.object({
	color: z.string().nullable().optional(),
	name: z.string(),
	nameShort: z.string().nullable(),
});

const votesSchema = z.object({
	total: z.number(),
	votePercent: z.number(),
});

const choiceSchema = z.object({
	elected: z.boolean(),
	firstName: z.string().nullable(),
	id: z.number(),
	incumbent: z.boolean(),
	lastName: z.string().nullable(),
	name: z.string(),
	name2: z.string().nullable(),
	party: partySchema.nullable(),
	position: z.number().nullable().optional(),
	votes: votesSchema,
});

const pollsSchema = z.object({
	closingTime: z.string(),
	isClosed: z.boolean(),
	reported: z.number(),
	reportedPercent: z.string(),
	total: z.number(),
});

// State/District/County are Chameleon "dynamic fields" — present only when set
// on that area. The built-in lowercase state/district/county carry the same
// data on the September 2026 General playlist; either may be absent.
const areaSchema = z.object({
	county: z.string().nullable().optional(),
	County: z.string().nullable().optional(),
	district: z.string().nullable().optional(),
	District: z.string().nullable().optional(),
	id: z.number(),
	name: z.string(),
	nameShort: z.string(),
	state: z.string().nullable().optional(),
	State: z.string().nullable().optional(),
});

const eventSchema = z.object({
	date: z.string(),
	id: z.number(),
	name: z.string(),
	type: z.string(),
});

const officeSchema = z.object({
	id: z.number(),
	name: z.string(),
});

const contestSchema = z.object({
	area: areaSchema,
	choice: z.array(choiceSchema),
	contestType: z.string(),
	// Chameleon's copy of DDHQ estimated_votes.turnout_mid — what the template
	// renders as "% IN". polls.reportedPercent is the precinct figure.
	dbVotesPercent: z.string(),
	event: eventSchema,
	id: z.number(),
	modifiedDate: z.string(),
	office: officeSchema,
	officename: z.string(),
	party: z.string().nullable(),
	polls: pollsSchema,
	// The DDHQ race_id this contest mirrors. Set on the General playlist; absent
	// on older playlists.
	raceID: z.string().nullable().optional(),
});

const electionPlaylistSchema = z.object({
	contest: z.array(contestSchema),
	id: z.number(),
	name: z.string(),
});

const responseSchema = z.object({
	ElectionPlaylist: electionPlaylistSchema,
	generated: z.string(),
});

export {
	choiceSchema as chameleonChoiceSchema,
	contestSchema as chameleonContestSchema,
	partySchema as chameleonPartySchema,
	responseSchema as chameleonResponseSchema,
};

export type ChameleonChoice = z.infer<typeof choiceSchema>;
export type ChameleonContest = z.infer<typeof contestSchema>;
export type ChameleonResponse = z.infer<typeof responseSchema>;
