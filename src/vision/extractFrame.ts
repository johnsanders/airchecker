import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { CandidateState, RaceObservation } from '../reconcile/reconcile.js';
import type { Rect, TemplateSpec } from '../templates/types.js';
import type { LlmClient, LlmTool } from './llmClient.js';

import { findTemplate, templateRegistry } from '../templates/registry.js';
import { cropAndUpscaleRegion } from './cropRegion.js';

// Matches a re-read called name back to one of pass-1's candidates: lowercase →
// strip diacritics → strip non-alphanumeric (same normalization the reconciler
// uses for cross-source matching).
const normalizeName = (name: string): string =>
	name
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]/g, '');

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

// Recall reads the called name as it appears (often surname only: "MIDDLETON"),
// while pass-1 may have the full name ("Mayes Middleton"). Match if either
// normalized name contains the other — tolerant of surname-vs-fullname and any
// residual bleed.
const namesMatch = (a: string, b: string): boolean => {
	const na = normalizeName(a);
	const nb = normalizeName(b);
	if (na.length === 0 || nb.length === 0) return false;
	return na === nb || na.includes(nb) || nb.includes(na);
};

// Pass 1 (full frame, bulk fields) is 30/30 on Haiku — cheap and sufficient.
// The recall pass reads a tiny ✓ glyph; Sonnet reads it 20/20 single-shot on the
// upscaled crop where Haiku needs ~3 votes, and the crop is small so the per-call
// cost increase is modest. Different model per pass, each doing what it's best at.
const DEFAULT_MODEL = 'claude-haiku-4-5';
const DEFAULT_RECALL_MODEL = 'claude-sonnet-4-6';
const TOOL_NAME = 'report_templates';

// One VLM call per frame: full frame + the registry as a menu → an array of the
// templates actually present, each with its singletons and candidate list.

const buildPrompt = (registry: readonly TemplateSpec[]): string => {
	const menu = registry
		.map((spec) => `- ${spec.id} (${spec.surface}): ${spec.vlmPromptHint}`)
		.join('\n');
	return [
		'You are inspecting a single frame of live election-night TV. Identify the on-air ELECTION RESULTS graphics — ones that show candidate names alongside vote totals or percentages.',
		'',
		'Known templates:',
		menu,
		'',
		'Rules:',
		'- Report each distinct results graphic EXACTLY ONCE. If only one ticker is on screen, return exactly one ticker entry — never repeat it.',
		'- Only report graphics that actually show candidate vote results. IGNORE headline chyrons ("DEVELOPING STORY", "BREAKING NEWS"), name supers, show promos, and "FOR MORE INFO" bars — they contain no candidate vote numbers.',
		'- For each results graphic: read its singleton fields (race_heading, pct_in) and one entry per candidate shown, in reading order left-to-right.',
		'- Report EVERY candidate the graphic displays — this package always shows exactly TWO per race, including the trailing one. Never stop after the leader.',
		'- ALWAYS fill race_heading with the race title exactly as printed — state, office, the party in parentheses when shown, and the district line when shown, joined with spaces (e.g. "TX | U.S. SENATE (D)", "WI | U.S. HOUSE (D) DISTRICT 7", "AL-2 U.S. HOUSE", "KS GOVERNOR"). ALWAYS fill pct_in with the "X% IN" reporting figure INCLUDING any ">" prefix (">95% IN"). Both are required for every results graphic — never leave them blank.',
		'- Read vote totals and percentages exactly as printed (totals may or may not have thousands separators).',
		'- "name" is the candidate\'s personal name ONLY: first name and surname as printed on the two stacked lines. The single party letter on the color chip (D, R, L, I, G…) goes in "party", NEVER in "name". For a chip "D" beside "JAMES TALARICO", return name "James Talarico" and party "D" — never name "D James Talarico".',
		'- Set "called" to "called" only when a gold/yellow ✓ check mark sits beside that candidate\'s surname; otherwise "". A "PROJECTION" banner is NOT a call.',
		'',
		'Report via the report_templates tool. If no results graphics are present, return an empty list.',
	].join('\n');
};

// Singletons were a freeform string map, so nothing forced the model to read
// race_heading — it came back empty ~25% of runs. Promote every declared
// singleton to an explicit string property and require the ones every template
// marks required, so the model must fill them (the candidate array never drifted
// precisely because it had a required typed schema).
const buildSingletonSchema = (registry: readonly TemplateSpec[]): Record<string, unknown> => {
	const names = Array.from(
		new Set(registry.flatMap((spec) => spec.singletons.map((field) => field.name))),
	);
	const requiredInEvery = names.filter((name) =>
		registry.every((spec) =>
			spec.singletons.some((field) => field.name === name && field.required),
		),
	);
	return {
		additionalProperties: { type: 'string' },
		properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
		required: requiredInEvery,
		type: 'object',
	};
};

const buildTool = (registry: readonly TemplateSpec[]): LlmTool => ({
	description: 'Report every on-air result template detected in the frame.',
	inputSchema: {
		additionalProperties: false,
		properties: {
			templates: {
				items: {
					additionalProperties: false,
					properties: {
						candidates: {
							items: {
								additionalProperties: false,
								properties: {
									called: { type: 'string' },
									name: { type: 'string' },
									party: { type: 'string' },
									pct: { type: 'string' },
									votes: { type: 'string' },
								},
								required: ['name'],
								type: 'object',
							},
							type: 'array',
						},
						singletons: buildSingletonSchema(registry),
						templateId: { enum: registry.map((spec) => spec.id), type: 'string' },
					},
					required: ['templateId', 'singletons', 'candidates'],
					type: 'object',
				},
				type: 'array',
			},
		},
		required: ['templates'],
		type: 'object',
	},
	name: TOOL_NAME,
});

const candidateSchema = z.object({
	called: z.string().optional(),
	name: z.string(),
	party: z.string().optional(),
	pct: z.string().optional(),
	votes: z.string().optional(),
});

const bodySchema = z.object({
	templates: z.array(
		z.object({
			candidates: z.array(candidateSchema),
			singletons: z.record(z.string(), z.string()),
			templateId: z.string(),
		}),
	),
});

const toInt = (raw: string | undefined): number => {
	const digits = (raw ?? '').replace(/[^0-9]/g, '');
	return digits.length === 0 ? 0 : Number(digits);
};

const toPct = (raw: string | undefined): number => {
	const cleaned = (raw ?? '').replace(/[^0-9.]/g, '');
	const value = Number(cleaned);
	return cleaned.length === 0 || Number.isNaN(value) ? 0 : value;
};

// The reporting badge prints ">95% IN" once a race is nearly complete; the number
// is then a floor, and the reconciler must not demand a point match against it.
const isMinimumPct = (raw: string | undefined): boolean => (raw ?? '').trim().startsWith('>');

// The badge is always supposed to be on screen; a read with no digit in it means the
// graphic didn't render one (a display bug the reconciler alerts on), not "0% in".
const pctInMissing = (raw: string | undefined): boolean => !/\d/.test(raw ?? '');
const missingFieldsFor = (pctInRaw: string | undefined): { missingFields?: string[] } =>
	pctInMissing(pctInRaw) ? { missingFields: ['pct_in'] } : {};

// Second pass — re-read the small-text fields from an UPSCALED crop. On the full
// 1920-wide frame, pass 1 nails the template/race/party/% but MISREADS small ticker
// digits (vote totals: 459,609→459,009, measured) and the tiny gold ✓ glyph (~60%).
// Cropping the captureRegion and upscaling ~3× makes both legible: Sonnet reads the
// full candidate list (names, votes, pct, called) 4/4 exact on the crop. So for any
// detected template WITH a captureRegion, this pass re-reads the candidates + pct_in
// from the crop and overrides pass 1's — pass 1 stays authoritative only for the
// template id and raceKey binding.
const RECROP_TOOL = 'report_crop';

const recropTool: LlmTool = {
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
	name: RECROP_TOOL,
};

// The name is read as its two printed lines: asked for one "name" field the
// model returned only the first name or only the surname often enough to lose
// legible tickers, and two required fields make it read both.
const recropCandidateSchema = z.object({
	called: z.string(),
	firstName: z.string(),
	party: z.string(),
	pct: z.string(),
	surname: z.string(),
	votes: z.string(),
});
const recropBodySchema = z.object({
	candidates: z.array(recropCandidateSchema),
	pctIn: z.string(),
	raceHeading: z.string().optional(),
});
type RecropCandidate = z.infer<typeof recropCandidateSchema>;
type RecropRead = z.infer<typeof recropBodySchema>;

const recropPrompt = (): string =>
	[
		'This is a zoomed-in crop of one on-air election result graphic.',
		"Read EVERY candidate exactly as printed: the name's SMALL upper line (first name) and LARGE lower line (surname) as two separate fields — never the party letter — plus the party letter from the color chip, the vote total (read each digit carefully — these are small), and the percentage.",
		'A candidate is "called" if a small gold/yellow check mark (✓) sits immediately beside their SURNAME — left of it on the ticker and lower-third, right of it on the fullscreen board. Set "called" to "called" for each candidate that has the mark, else "". A "PROJECTION" banner is not a call.',
		'Also read the race heading exactly as printed (state, office, party in parentheses if shown, a DISTRICT line if shown — never the "X% IN" figure, which is not a district) and the "X% IN" reporting figure exactly as printed, including any ">" prefix. Report via the report_crop tool.',
	].join('\n');

// One crop read. `extra.vote` varies the prompt-hash per vote so each is recorded/
// replayed as a distinct golden entry (the API ignores it). Votes are UNIONed for
// the call set (a ✓ seen by any vote counts); for the numeric fields the first
// read wins (they agree — measured 4/4 — and a single Sonnet read is reliable).
const recropReadOnce = async (
	cropPng: Buffer,
	vote: number,
	deps: ExtractFrameDeps,
): Promise<RecropRead> => {
	const response = await deps.client.call({
		extra: { vote },
		frameHash: createHash('sha256').update(cropPng).digest('hex'),
		image: { base64: cropPng.toString('base64'), mediaType: 'image/png' },
		model: deps.recallModel ?? deps.model ?? DEFAULT_RECALL_MODEL,
		prompt: recropPrompt(),
		tool: recropTool,
		toolChoice: RECROP_TOOL,
	});
	return recropBodySchema.parse(response.body);
};

const DEFAULT_RECALL_VOTES = 1;

export type ExtractFrameDeps = {
	client: LlmClient;
	model?: string;
	// Model for the recall (call-detection) pass. Defaults to Sonnet, which reads
	// the ✓ glyph reliably single-shot; falls back to `model` then the constant.
	recallModel?: string;
	// Set false to skip the re-call pass (e.g. unit tests with a fake client).
	recallPass?: boolean;
	// Number of recall votes per template (OR-ed). Default 1 (Sonnet is reliable
	// single-shot); bump for a weaker recall model.
	recallVotes?: number;
	// Crops + upscales a template's captureRegion for the re-call pass. Injected so
	// tests can stub it; defaults to the real sharp-backed implementation.
	recropRegion?: (framePng: Buffer, region: Rect) => Promise<Buffer>;
	registry?: readonly TemplateSpec[];
};

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
			// it's the mid-flip signature: the crop read couldn't make out a sliced field.
			(candidate.pct > 0 && candidate.votes === 0) ||
			(candidate.votes > 0 && candidate.pct === 0),
	);

export const extractFrame = async (
	framePng: Buffer,
	observedAt: number,
	deps: ExtractFrameDeps,
): Promise<RaceObservation[]> => {
	const registry = deps.registry ?? templateRegistry;
	const model = deps.model ?? DEFAULT_MODEL;
	const frameHash = createHash('sha256').update(framePng).digest('hex');

	const response = await deps.client.call({
		frameHash,
		image: { base64: framePng.toString('base64'), mediaType: 'image/png' },
		model,
		prompt: buildPrompt(registry),
		tool: buildTool(registry),
		toolChoice: TOOL_NAME,
	});

	const parsed = bodySchema.parse(response.body);

	// The VLM intermittently repeats the same graphic many times in the array;
	// "exactly once" prompting is unreliable, so collapse byte-identical detections
	// here. Distinct races under the same template (different raceKey/candidates)
	// survive — only true duplicates are dropped.
	const seen = new Set<string>();
	const deduped = parsed.templates.filter((item) => {
		const signature = JSON.stringify([
			item.templateId,
			item.singletons,
			item.candidates.map((candidate) => [candidate.name, candidate.votes, candidate.pct]),
		]);
		if (seen.has(signature)) return false;
		seen.add(signature);
		return true;
	});

	const observations = deduped
		.map((item): null | RaceObservation => {
			const spec = findTemplate(item.templateId);
			if (spec === undefined) return null;
			const cleanName = (candidate: z.infer<typeof candidateSchema>): string =>
				stripPartyPrefix(candidate.name, candidate.party ?? '');
			const candidateRecord = (
				candidate: z.infer<typeof candidateSchema>,
			): Record<string, string> => ({
				called: candidate.called ?? '',
				name: cleanName(candidate),
				party: candidate.party ?? '',
				pct: candidate.pct ?? '',
				votes: candidate.votes ?? '',
			});
			const candidates: CandidateState[] = item.candidates.map((candidate) => ({
				key: spec.bind.candidateKeyFrom(candidateRecord(candidate)),
				name: cleanName(candidate),
				party: candidate.party ?? '',
				pct: toPct(candidate.pct),
				votes: toInt(candidate.votes),
			}));
			const calledFor = item.candidates
				.filter((candidate) => (candidate.called ?? '') === 'called')
				.map((candidate) => spec.bind.candidateKeyFrom(candidateRecord(candidate)));
			return {
				calledFor,
				candidates,
				extractedFields: item.singletons,
				observedAt,
				...missingFieldsFor(item.singletons.pct_in),
				pctIn: toPct(item.singletons.pct_in),
				...(isMinimumPct(item.singletons.pct_in) ? { pctInIsMinimum: true } : {}),
				raceKey: spec.bind.raceKeyFrom(item.singletons),
				reportedAt: null,
				source: 'air',
				templateId: spec.id,
			};
		})
		.filter((observation): observation is RaceObservation => observation !== null);

	// Re-crop pass is on by default (it's the production-correct behavior). Isolated
	// unit tests that use a single-response fake client pass recallPass: false.
	if (deps.recallPass === false)
		return observations.filter((observation) => !isMissedCapture(observation));
	const recrop = deps.recropRegion ?? cropAndUpscaleRegion;
	const votes = deps.recallVotes ?? DEFAULT_RECALL_VOTES;
	const specsWithRegion = registry.filter((spec) => spec.captureRegion !== undefined);

	// One set of crop reads per template REGION, read lazily and shared by every
	// pass-1 item on the frame. Pass 1 occasionally swaps the two strip labels (files
	// the lower-third as the ticker and vice versa); matching each roster against the
	// regions' reads — its own first — recovers the right template from reads the
	// frame already paid for, instead of dropping both.
	const readsByTemplate = new Map<string, Promise<RecropRead[]>>();
	const readRegion = (spec: TemplateSpec, region: Rect): Promise<RecropRead[]> => {
		const cached = readsByTemplate.get(spec.id);
		if (cached !== undefined) return cached;
		const pending = recrop(framePng, region).then((cropPng) =>
			Promise.all(
				Array.from({ length: votes }, (_unused, index) => recropReadOnce(cropPng, index, deps)),
			),
		);
		readsByTemplate.set(spec.id, pending);
		return pending;
	};

	// Pass 1 owns the roster (names/keys — it reads full names reliably); the crop
	// read owns the small print (votes, pct, ✓). The crop read tends to return only
	// one of the two stacked name lines, so match its rows back to pass 1's by
	// position first, then by partial name.
	const cropName = (c: RecropCandidate): string =>
		stripPartyPrefix(`${c.firstName} ${c.surname}`.trim(), c.party);
	const cropRowsFor = (
		primary: RecropRead,
		roster: CandidateState[],
	): (RecropCandidate | undefined)[] =>
		roster.map((passOne, index) => {
			const byIndex = primary.candidates[index];
			if (byIndex !== undefined && namesMatch(cropName(byIndex), passOne.name)) return byIndex;
			return primary.candidates.find((c) => namesMatch(cropName(c), passOne.name));
		});

	type MatchState = { attempted: number; errors: unknown[] };
	type RegionMatch = {
		cropRows: (RecropCandidate | undefined)[];
		reads: RecropRead[];
		spec: TemplateSpec;
	};
	// Own label first; after a miss, regions the frame has already read (another
	// item's, in the swap case) before paying for a fresh crop. First region whose
	// crop shows any of the roster wins.
	const matchRegion = async (
		roster: CandidateState[],
		own: TemplateSpec | undefined,
		remaining: TemplateSpec[],
		state: MatchState,
	): Promise<RegionMatch | undefined> => {
		const spec =
			own ?? remaining.find((candidate) => readsByTemplate.has(candidate.id)) ?? remaining[0];
		if (spec?.captureRegion === undefined) {
			// Nothing matched. Surface an API failure rather than silently dropping —
			// but only when no region could be read at all; a failed *fallback* read
			// while other reads succeeded just means no recovery for this item.
			if (state.errors.length > 0 && state.errors.length === state.attempted) throw state.errors[0];
			return undefined;
		}
		const reads = await readRegion(spec, spec.captureRegion).catch((error: unknown) => {
			state.errors.push(error);
			return undefined;
		});
		const cropRows = reads === undefined ? [] : cropRowsFor(reads[0]!, roster);
		if (reads !== undefined && cropRows.some((row) => row !== undefined))
			return { cropRows, reads, spec };
		return matchRegion(
			roster,
			undefined,
			remaining.filter((candidate) => candidate.id !== spec.id),
			{ attempted: state.attempted + 1, errors: state.errors },
		);
	};

	const recropped = await Promise.all(
		observations.map(async (observation): Promise<null | RaceObservation> => {
			const own = findTemplate(observation.templateId ?? '');
			if (own?.captureRegion === undefined) return observation;
			const match = await matchRegion(
				observation.candidates,
				own,
				specsWithRegion.filter((spec) => spec.id !== own.id),
				{ attempted: 0, errors: [] },
			);
			// The roster is in no region's crop: nothing read from the frame belongs to
			// it (a mid-flip slice, or a graphic that isn't where any template lives).
			if (match === undefined) return null;
			const { cropRows, reads, spec } = match;
			const primary = reads[0]!; // numeric fields: first read (they agree)

			// Union the called set across votes (a ✓ seen by any vote counts).
			const calledNames = new Set(
				reads.flatMap((read) => read.candidates.filter((c) => c.called === 'called').map(cropName)),
			);
			const candidates: CandidateState[] = observation.candidates.map((passOne, index) => {
				const cropRow = cropRows[index];
				if (cropRow === undefined) return passOne; // crop didn't clearly see this row
				return {
					...passOne,
					party: cropRow.party.length > 0 ? cropRow.party : passOne.party,
					pct: toPct(cropRow.pct),
					votes: toInt(cropRow.votes),
				};
			});
			const calledFor = candidates
				.filter((c) => Array.from(calledNames).some((called) => namesMatch(c.name, called)))
				.map((c) => c.key);

			// Pass 2 is authoritative for pct_in (value, ">N" floor, presence) and — when it
			// read one — for the heading: the zoomed crop is where the stronger model reads,
			// and pass 1 sometimes folds the badge or a phantom district into the heading.
			// A swapped label is corrected to the template whose region held the roster.
			const {
				missingFields: _passOneMissing,
				pctInIsMinimum: _passOneFloor,
				...rest
			} = observation;
			const cropHeading = primary.raceHeading?.trim() ?? '';
			const extractedFields = {
				...(observation.extractedFields ?? {}),
				...(cropHeading.length > 0 ? { race_heading: cropHeading } : {}),
			};
			return {
				...rest,
				calledFor,
				candidates,
				extractedFields,
				...missingFieldsFor(primary.pctIn),
				pctIn: toPct(primary.pctIn),
				...(isMinimumPct(primary.pctIn) ? { pctInIsMinimum: true } : {}),
				raceKey: spec.bind.raceKeyFrom(extractedFields),
				templateId: spec.id,
			};
		}),
	);
	const survivors = recropped.filter(
		(observation): observation is RaceObservation => observation !== null,
	);

	// Always-on surfaces (the ticker) must not depend on pass 1 noticing them: on the
	// video dry run Haiku missed the ticker under a fullscreen on 2 of 8 such frames.
	// When no pass-1 item survived for such a template, read its region anyway (a
	// cache hit when pass 1 did see it) and build the observation from the crop read.
	// The missed-capture guard still applies, so a promo bar or a mid-flip yields none.
	const synthesized = await Promise.all(
		specsWithRegion
			.filter(
				(spec) =>
					spec.alwaysOnAir === true &&
					!survivors.some((observation) => observation.templateId === spec.id),
			)
			.map(async (spec): Promise<null | RaceObservation> => {
				const reads = await readRegion(spec, spec.captureRegion!);
				const primary = reads[0]!;
				if (primary.candidates.length === 0) return null;
				const extractedFields = {
					pct_in: primary.pctIn,
					race_heading: primary.raceHeading?.trim() ?? '',
				};
				const recordFor = (c: RecropCandidate): Record<string, string> => ({
					called: c.called,
					name: cropName(c),
					party: c.party,
					pct: c.pct,
					votes: c.votes,
				});
				const candidates: CandidateState[] = primary.candidates.map((c) => ({
					key: spec.bind.candidateKeyFrom(recordFor(c)),
					name: cropName(c),
					party: c.party,
					pct: toPct(c.pct),
					votes: toInt(c.votes),
				}));
				const calledNames = new Set(
					reads.flatMap((read) =>
						read.candidates.filter((c) => c.called === 'called').map(cropName),
					),
				);
				return {
					calledFor: candidates
						.filter((c) => Array.from(calledNames).some((called) => namesMatch(c.name, called)))
						.map((c) => c.key),
					candidates,
					extractedFields,
					...missingFieldsFor(primary.pctIn),
					observedAt,
					pctIn: toPct(primary.pctIn),
					...(isMinimumPct(primary.pctIn) ? { pctInIsMinimum: true } : {}),
					raceKey: spec.bind.raceKeyFrom(extractedFields),
					reportedAt: null,
					source: 'air',
					templateId: spec.id,
				};
			}),
	);

	return [...survivors, ...synthesized].filter(
		(observation): observation is RaceObservation =>
			observation !== null && !isMissedCapture(observation),
	);
};

export type { Rect };
