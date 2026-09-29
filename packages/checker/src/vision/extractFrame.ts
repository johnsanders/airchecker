import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { CandidateState, RaceObservation } from '../reconcile/reconcile.js';
import type { Rect, TemplateSpec } from '../templates/types.js';
import type { LlmClient, LlmTool } from './llmClient.js';

import { headingRaceKey } from '../templates/headingKey.js';
import { templateRegistry } from '../templates/registry.js';
import { cropAndUpscaleRegion } from './cropRegion.js';

// Reads a frame of air. Each template sits in a fixed region of the frame, so each
// region is cropped, sized for the API, and read on its own by one model call that is
// told which graphic the region holds when it holds any. What comes back for a region
// becomes that template's observation; a region showing no graphic yields none.
//
// Measured 2026-09-29 against the two passes this replaced (a full-frame read by Haiku
// to find the graphics and their names, then these same crop reads for the small print):
// all 23 frame goldens × 3 and the 8 hardest × 20 exact either way, and on 50 frames of
// the simulator's air 74 of 74 graphics found with every field right, where two passes
// found 71 and misread a name. The full-frame read was what mislabelled the lower third
// and misread names; the crop read it handed over to had them right. A third cheaper,
// too: ≈ $4 an hour at the 5 s cadence. Sonnet 4.6 reads the crops as well at ≈ $19.
export const DEFAULT_MODEL = 'gemini-3.8-flash';

const TOOL_NAME = 'report_crop';

const readTool: LlmTool = {
	description:
		'Read every candidate and the reporting percentage from a zoomed-in election graphic crop.',
	inputSchema: {
		additionalProperties: false,
		properties: {
			candidates: {
				items: {
					additionalProperties: false,
					properties: {
						called: {
							description:
								'Exactly "called" if a gold/yellow check mark (✓) sits beside this candidate\'s surname; else "". A "PROJECTION" banner is not a call.',
							type: 'string',
						},
						firstName: {
							description:
								'The SMALL upper line of the candidate\'s name (first name, e.g. "James") exactly as printed — never the party letter.',
							type: 'string',
						},
						party: {
							description: 'Party letter from the color chip (D, R, L, I, G…).',
							type: 'string',
						},
						pct: {
							description: 'Percentage exactly as printed (e.g. "52.4%").',
							type: 'string',
						},
						surname: {
							description:
								'The LARGE lower line of the candidate\'s name (surname, e.g. "TALARICO") exactly as printed.',
							type: 'string',
						},
						votes: {
							description:
								'Vote total exactly as printed (read every digit carefully; may or may not have thousands separators).',
							type: 'string',
						},
					},
					required: ['firstName', 'surname', 'party', 'votes', 'pct', 'called'],
					type: 'object',
				},
				type: 'array',
			},
			pctIn: {
				description:
					'The "X% IN" reporting figure as printed, including any ">" prefix (e.g. ">95%").',
				type: 'string',
			},
			raceHeading: {
				description:
					'The race heading exactly as printed: state, office, the party in parentheses if shown, and a DISTRICT line if shown (e.g. "TX | U.S. SENATE (D)", "AL-2 U.S. HOUSE"). Never include the "X% IN" figure — it is not a district.',
				type: 'string',
			},
		},
		required: ['candidates', 'pctIn', 'raceHeading'],
		type: 'object',
	},
	name: TOOL_NAME,
};

// The name is read as its two printed lines: asked for one "name" field the
// model returned only the first name or only the surname often enough to lose
// legible tickers, and two required fields make it read both.
const candidateSchema = z.object({
	called: z.string(),
	firstName: z.string(),
	party: z.string(),
	pct: z.string(),
	surname: z.string(),
	votes: z.string(),
});

const readSchema = z.object({
	candidates: z.array(candidateSchema),
	pctIn: z.string(),
	raceHeading: z.string().optional(),
});

type ReadCandidate = z.infer<typeof candidateSchema>;

type RegionRead = z.infer<typeof readSchema>;

// The wording is what was measured. A change to it, or to the tool above, is a change to
// what the model is asked, and wants measuring again (src/tools/verifyExtraction.ts)
// and the frame goldens recording again.
const regionPrompt = (spec: TemplateSpec): string =>
	[
		'This is a zoomed-in crop of one region of a frame of live election-night TV. When this results graphic is on air, this region is where it sits:',
		spec.vlmPromptHint,
		'If the crop does not show that graphic — programming, a headline chyron, a name super, a promo, or only a sliver of some other graphic — report an empty candidates list and empty strings for the other fields. Do not report candidates from anything else.',
		'Otherwise:',
		'This is a zoomed-in crop of one on-air election result graphic.',
		"Read EVERY candidate exactly as printed: the name's SMALL upper line (first name) and LARGE lower line (surname) as two separate fields — never the party letter — plus the party letter from the color chip, the vote total (read each digit carefully — these are small), and the percentage.",
		'A candidate is "called" if a small gold/yellow check mark (✓) sits immediately beside their SURNAME — left of it on the ticker and lower-third, right of it on the fullscreen board. Set "called" to "called" for each candidate that has the mark, else "". A "PROJECTION" banner is not a call.',
		'Also read the race heading exactly as printed (state, office, party in parentheses if shown, a DISTRICT line if shown — never the "X% IN" figure, which is not a district) and the "X% IN" reporting figure exactly as printed, including any ">" prefix. Report via the report_crop tool.',
	].join('\n');

const toInt = (raw: string): number => {
	const digits = raw.replace(/[^0-9]/g, '');
	return digits.length === 0 ? 0 : Number(digits);
};

const toPct = (raw: string): number => {
	const cleaned = raw.replace(/[^0-9.]/g, '');
	const value = Number(cleaned);
	return cleaned.length === 0 || Number.isNaN(value) ? 0 : value;
};

// The party chip's letter bleeds into the name on tight layouts (the ticker):
// "R MAYES MIDDLETON" with party "R". Deterministically strip a leading single-
// letter token when it matches the party field — belt-and-suspenders behind the
// prompt rule, which proved unreliable on the ticker.
const stripPartyPrefix = (name: string, party: string): string => {
	const match = /^([A-Za-z])\s+(.+)$/.exec(name.trim());
	if (match !== null && party.length > 0 && match[1]!.toUpperCase() === party.toUpperCase())
		return match[2]!;
	return name;
};

const nameOf = (candidate: ReadCandidate): string =>
	stripPartyPrefix(`${candidate.firstName} ${candidate.surname}`.trim(), candidate.party);

// A frame caught mid-transition (a graphic sliding in or out) yields a partial read —
// typically a candidate showing only a surname before the first name has scrolled in.
// We can't reconcile a partial roster, so treat any race whose candidates aren't all
// full "First Last" names as a missed capture and drop it rather than emit bad data.
// A name token is letters (with the usual hyphen/apostrophe/period), never a
// placeholder the model invents for an unreadable field ("<UNKNOWN>", "—").
const WORD_TOKEN = /^\p{L}[\p{L}'’.\-]*$/u;
// Every race heading in the package opens with a state code, optionally with a
// district ("AL-2"), then the office. Anything else ("DD26", "<UNKNOWN>", a stray
// party letter) is not a race and must not become a store bucket.
const RACE_KEY_SHAPE = /^[A-Z]{2}(?:-\d+)? \S/;

const isMissedCapture = (observation: RaceObservation): boolean =>
	!RACE_KEY_SHAPE.test(observation.raceKey) ||
	observation.candidates.some(
		(candidate) =>
			candidate.name.trim().split(/\s+/).length < 2 ||
			!candidate.name
				.trim()
				.split(/\s+/)
				.every((token) => WORD_TOKEN.test(token)) ||
			// A nonzero share with zero votes (or votes with no share) is impossible —
			// it's the mid-flip signature: the read couldn't make out a sliced field.
			(candidate.pct > 0 && candidate.votes === 0) ||
			(candidate.votes > 0 && candidate.pct === 0),
	);

const observationFrom = (
	read: RegionRead,
	spec: TemplateSpec,
	observedAt: number,
): RaceObservation => {
	const candidates: CandidateState[] = read.candidates.map((candidate) => ({
		key: nameOf(candidate),
		name: nameOf(candidate),
		party: candidate.party,
		pct: toPct(candidate.pct),
		votes: toInt(candidate.votes),
	}));
	return {
		calledFor: read.candidates
			.filter((candidate) => candidate.called === 'called')
			.map((candidate) => nameOf(candidate)),
		candidates,
		// The badge is always supposed to be on screen; a read with no digit in it means the
		// graphic didn't render one (a display bug the reconciler alerts on), not "0% in".
		...(/\d/.test(read.pctIn) ? {} : { missingFields: ['pct_in'] }),
		observedAt,
		pctIn: toPct(read.pctIn),
		// The badge prints ">95% IN" once a race is nearly complete; the number is then a
		// floor, and the reconciler must not demand a point match against it.
		...(read.pctIn.trim().startsWith('>') ? { pctInIsMinimum: true } : {}),
		raceKey: headingRaceKey(read.raceHeading ?? ''),
		reportedAt: null,
		source: 'air',
		templateId: spec.id,
	};
};

export type ExtractFrameDeps = {
	client: LlmClient;
	// Crops a template's region out of the frame and sizes it for the API. Injected so
	// tests can stub it; defaults to the real sharp-backed implementation.
	cropRegion?: (framePng: Buffer, region: Rect) => Promise<Buffer>;
	model?: string;
	registry?: readonly TemplateSpec[];
};

// One failed read fails the frame: the next capture is seconds away, and the air source
// shows as failing meanwhile, where a frame quietly missing a graphic would not.
export const extractFrame = async (
	framePng: Buffer,
	observedAt: number,
	deps: ExtractFrameDeps,
): Promise<RaceObservation[]> => {
	const crop = deps.cropRegion ?? cropAndUpscaleRegion;
	// Every read is recorded under the frame it came from.
	const frameHash = createHash('sha256').update(framePng).digest('hex');
	const observations = await Promise.all(
		(deps.registry ?? templateRegistry).map(async (spec) => {
			const cropPng = await crop(framePng, spec.captureRegion);
			const response = await deps.client.call({
				frameHash,
				image: { base64: cropPng.toString('base64'), mediaType: 'image/png' },
				model: deps.model ?? DEFAULT_MODEL,
				prompt: regionPrompt(spec),
				tool: readTool,
				toolChoice: TOOL_NAME,
			});
			return observationFrom(readSchema.parse(response.body), spec, observedAt);
		}),
	);
	return observations.filter(
		(observation) => observation.candidates.length > 0 && !isMissedCapture(observation),
	);
};

export type { Rect };
