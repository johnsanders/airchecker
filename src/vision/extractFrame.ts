import { createHash } from 'node:crypto';
import { z } from 'zod';

import type { CandidateState, RaceObservation } from '../reconcile/reconcile.js';
import { findTemplate, templateRegistry } from '../templates/registry.js';
import type { Rect, TemplateSpec } from '../templates/types.js';
import { cropAndUpscaleRegion } from './cropRegion.js';
import type { LlmClient, LlmTool } from './llmClient.js';

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
    '- Only report graphics that actually show candidate vote results. IGNORE news headlines, breaking-news banners, story chyrons, and lower-thirds that contain only a headline or topic and no candidate vote numbers.',
    '- For each results graphic: read its singleton fields (e.g. race_heading, pct_in) and one entry per candidate shown, in reading order (left-to-right for rows, top-to-bottom for columns).',
    '- Report EVERY candidate the graphic displays, including trailing and losing candidates and any with low or zero votes. Never stop after the leader — if two candidates are shown, return two entries; if five are shown, return five.',
    '- ALWAYS fill race_heading with the race title exactly as printed (e.g. "TX U.S. SENATE (R)") and pct_in with the "X% IN" reporting figure. These are required for every results graphic — never leave them blank.',
    '- Read vote totals and percentages exactly as printed.',
    '- "name" is the candidate\'s personal name ONLY. The single party letter on the color chip (D, R, L, I, G…) goes in "party", NEVER in "name". For a chip "R" beside "MAYES MIDDLETON", return name "Mayes Middleton" and party "R" — never name "R Mayes Middleton".',
    '- Set "called" to "called" only when the candidate has a check mark or is clearly the winner; otherwise "".',
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
    registry.every((spec) => spec.singletons.some((field) => field.name === name && field.required)),
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

// Second pass — fixes ONLY calledFor. On the full frame the model reads the gold
// ✓ glyph ~60% of the time; on the upscaled captureRegion crop it reads 30/30.
// So when a detected template has a captureRegion, re-read just the call from the
// crop and override pass-1's calledFor. Every other field is already 30/30 on
// pass 1, so this pass deliberately touches nothing else.
const RECALL_TOOL = 'report_call';

const recallTool: LlmTool = {
  description: 'Report which candidates, if any, have been called/declared winners (have a check mark).',
  inputSchema: {
    additionalProperties: false,
    properties: {
      calledCandidateNames: {
        description:
          'Exact names of EVERY candidate with a yellow/gold check mark. Empty array if none. Top-two races can have two.',
        items: { type: 'string' },
        type: 'array',
      },
    },
    required: ['calledCandidateNames'],
    type: 'object',
  },
  name: RECALL_TOOL,
};

const recallBodySchema = z.object({ calledCandidateNames: z.array(z.string()) });

const recallPrompt = (raceHeading: string): string =>
  [
    `This is a zoomed-in crop of one on-air election result graphic (${raceHeading}).`,
    'A candidate is "called" if a small yellow/gold check mark (✓) sits next to their name, party chip, or percentage. ZERO, ONE, OR MORE candidates may be called — top-two races (primaries/runoffs) commonly show TWO check marks.',
    'Look carefully at EVERY candidate. Report the exact name of each candidate that has a check mark (empty array if none). Report via the report_call tool.',
  ].join('\n');

const DEFAULT_RECALL_VOTES = 1;

// Single crop read of the calls. The `extra.vote` field varies the prompt-hash per
// vote so each is recorded/replayed as a distinct golden entry (the API ignores it).
const detectCallOnce = async (
  cropPng: Buffer,
  raceHeading: string,
  vote: number,
  deps: ExtractFrameDeps,
): Promise<string[]> => {
  const response = await deps.client.call({
    extra: { vote },
    frameHash: createHash('sha256').update(cropPng).digest('hex'),
    image: { base64: cropPng.toString('base64'), mediaType: 'image/png' },
    model: deps.recallModel ?? deps.model ?? DEFAULT_RECALL_MODEL,
    prompt: recallPrompt(raceHeading),
    tool: recallTool,
    toolChoice: RECALL_TOOL,
  });
  return recallBodySchema
    .parse(response.body)
    .calledCandidateNames.map((name) => name.trim())
    .filter((name) => name.length > 0);
};

// Vote N times and UNION the results: a candidate is called if ANY vote sees its ✓.
// Statistically sound because recall errors are pure misses, never false calls —
// so union drives the per-candidate miss rate toward (single-miss-rate)^N.
const detectCallsInCrop = async (
  cropPng: Buffer,
  raceHeading: string,
  votes: number,
  deps: ExtractFrameDeps,
): Promise<string[]> => {
  const reads = await Promise.all(
    Array.from({ length: votes }, (_unused, index) =>
      detectCallOnce(cropPng, raceHeading, index, deps),
    ),
  );
  return Array.from(new Set(reads.flat()));
};

export type ExtractFrameDeps = {
  client: LlmClient;
  model?: string;
  // Crops + upscales a template's captureRegion for the re-call pass. Injected so
  // tests can stub it; defaults to the real sharp-backed implementation.
  recropRegion?: (framePng: Buffer, region: Rect) => Promise<Buffer>;
  registry?: readonly TemplateSpec[];
  // Set false to skip the re-call pass (e.g. unit tests with a fake client).
  recallPass?: boolean;
  // Model for the recall (call-detection) pass. Defaults to Sonnet, which reads
  // the ✓ glyph reliably single-shot; falls back to `model` then the constant.
  recallModel?: string;
  // Number of recall votes per template (OR-ed). Default 1 (Sonnet is reliable
  // single-shot); bump for a weaker recall model.
  recallVotes?: number;
};

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
    .map((item): RaceObservation | null => {
      const spec = findTemplate(item.templateId);
      if (spec === undefined) return null;
      const cleanName = (candidate: z.infer<typeof candidateSchema>): string =>
        stripPartyPrefix(candidate.name, candidate.party ?? '');
      const candidateRecord = (candidate: z.infer<typeof candidateSchema>): Record<string, string> => ({
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
        pctIn: toPct(item.singletons.pct_in),
        raceKey: spec.bind.raceKeyFrom(item.singletons),
        reportedAt: null,
        source: 'air',
        templateId: spec.id,
      };
    })
    .filter((observation): observation is RaceObservation => observation !== null);

  // Re-call pass is on by default (it's the production-correct behavior). Isolated
  // unit tests that use a single-response fake client pass recallPass: false.
  if (deps.recallPass === false) return observations;
  const recrop = deps.recropRegion ?? cropAndUpscaleRegion;

  // Re-call pass: only for templates with a captureRegion. Overrides calledFor
  // from the upscaled crop, matching the re-read name to a pass-1 candidate.
  return Promise.all(
    observations.map(async (observation) => {
      const spec = findTemplate(observation.templateId ?? '');
      if (spec?.captureRegion === undefined) return observation;
      const cropPng = await recrop(framePng, spec.captureRegion);
      const calledNames = await detectCallsInCrop(
        cropPng,
        observation.extractedFields?.race_heading ?? observation.raceKey,
        deps.recallVotes ?? DEFAULT_RECALL_VOTES,
        deps,
      );
      // Map each re-read name to a pass-1 candidate key; the recall pass is
      // authoritative for the call set, so it replaces (not merges) calledFor.
      const calledFor = calledNames
        .map((calledName) =>
          observation.candidates.find((candidate) => namesMatch(candidate.name, calledName)),
        )
        .filter((candidate): candidate is CandidateState => candidate !== undefined)
        .map((candidate) => candidate.key);
      return { ...observation, calledFor };
    }),
  );
};

export type { Rect };
