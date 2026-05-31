# CLAUDE.md

Eagle Eye is an observer for live election-night TV graphics. It reconciles three independent streams — political provider API (DDHQ), graphics vendor DB (Chameleon), and on-air visual capture (DirecTV window via MCP screenshot) — and flags inconsistencies for human review. Greenfield TypeScript/Node service.

## Quick start

```bash
npm install
npm test         # vitest run
npm run test:watch
npm run typecheck
```

## Architecture

Single Node service. Three long-running loops feed one shared store; a pure reconciler runs over rolling per-race timelines; surgical LLM calls handle vision; an always-on recorder makes replay the test backbone.

```
provider API   →  providerPoller  ─┐  (feeds vendor-driven reconciliation AND magic-wall direct comparison)
vendor DB      →  vendorPoller    ─┼→  Store (per-race timelines + append log)
DirecTV window →  airCapturer     ─┤        ↓
                  └─ extractFrame (two-pass: Haiku reads full frame + registry menu →
                     templates present; Sonnet re-reads upscaled crop for the called ✓)
                                            ↓
                                        Reconciler  →  AlertSink (log + Fastify web view)
```

Full plan (architecture rationale, MVP scope, deferred work, verification approach): [`docs/PLAN.md`](docs/PLAN.md).

## Project layout

```
src/
  templates/        TemplateSpec types + one spec file per on-air template
  sources/
    common.ts       Shared race-key composition + party-letter mapping (MUST be shared so keys align across sources)
    provider/       DDHQ schema + adapter
    vendor/         Chameleon schema + adapter
    air/            (planned) MCP screenshot driver + frame buffer
  vision/           extractFrame (two-pass VLM: Haiku bulk + Sonnet call-recrop), anthropicClient, goldenClient, cropRegion, llmClient, redact
  tools/            calibrate / probe / capture-golden / verify / measure-call
  store/            In-memory ring buffer per source with onRecord hook for recorder
  reconcile/        Pure triangulation + severity functions; thresholds in thresholds.ts
  alerts/           (planned) Sink interface, logSink, webSink
  web/              (planned) Fastify; live state, recent alerts, last frame with overlay
  replay/           Recorder + player; recorder is sessions/observations/frames/llm_calls SQLite + content-addressed PNGs
  runtime/          composition.ts + liveMain.ts + replayMain.ts
tests/              Vitest; reconciler rules + adapters + store
```

Sample fixtures (real responses, kept in repo root):

- `ddhq_response_example.json` — DDHQ provider response
- `chameleon_response_example.json` — Chameleon vendor response (large; ~350KB, 49 contests)

## Core concepts

### `RaceObservation`

One record per source per race per observation. The reconciler operates only on these.

```ts
type RaceObservation = {
	source: 'DDHQ' | 'Ross' | 'air'; // provider | vendor | on-air capture
	observedAt: number; // when WE recorded it (ms epoch)
	reportedAt: number | null; // upstream timestamp if available
	raceKey: string;
	pctIn: number;
	candidates: CandidateState[];
	calledFor: string[]; // candidate keys called/advancing; empty = none. A SET, order-insensitive.
	templateId?: string; // air only
	extractedFields?: Record<string, string>; // air only
};
```

`calledFor` is a **set of candidate keys**, not a single winner — top-two primaries/runoffs (and multi-seat races) genuinely call two. DDHQ uses all `called_candidates`; Chameleon all `elected` choices; the air extractor's recall pass reads every ✓. The reconciler's call rules compare it set-wise (order-insensitive), and flag `missing_call` when air shows a strict subset of the provider's called set (e.g. air caught only the leader's check mark in a two-winner race). The `recordings/goldens/fs_ga11_house_*` goldens lock this in.

### `TemplateSpec`

Declarative description of an on-air template — what it looks like and what to read off it, NOT pixel coordinates for each field. The VLM localizes fields itself within the crop. Each spec has:

- `captureRegion?` — ONE loose region (as normalized `{x,y,w,h}` fractions in `[0..1]`, resolution-independent via `scaleRectToFrame`) that contains the whole graphic. Not a per-field map — it's the crop the pass-2 call-detection re-reads (upscaled). Absent for locatable templates (magic wall), where detection returns a bbox.
- `vlmPromptHint` — prose telling the model what the surface looks like (used as the per-template entry in the extract-all menu).
- `singletons` — single-valued fields the model reads (e.g. `race_heading`, `pct_in`). No rects.
- `candidateList?` — the reflowing candidate cards. The model returns an **array** of whatever length is on screen (2–5 cards fullscreen, 2–3 sideSlab/ticker/lower-third), so the spec is agnostic to candidate count. `layout: 'row' | 'column'`.
- `bind` — `raceKeyFrom(singletons)` and `candidateKeyFrom(candidate)`.

Four real specs exist (`fullscreenResults`, `sideSlab`, `lowerThird`, `tickerV1`), authored + region-verified against reference frames in `recordings/reference-frames/`. The ticker FLIPS between races (one race per flip; not a scroll), so fixed regions hold. Per-field pixel rects and pixel/color fingerprints were removed — they were brittle and the VLM doesn't need them.

`dataPath` is either `'vendor'` (3-source reconciliation: DDHQ + Ross + air) or `'provider_direct'` (2-source: DDHQ + air — for the magic wall, which bypasses Ross).

### Race-key composition (load-bearing invariant)

All sources MUST produce the same `raceKey` for the same political race. Use `composeRaceKey()` in `src/sources/common.ts`. The formula is `${year}-${state}-${slugify(office)}-${district||'AL'}-${slugify(party)||'NP'}-${slugify(contestType)}`.

A regression test (`tests/chameleonAdapter.test.ts` → "cross-source race key alignment") asserts this against a synthetic DDHQ + Chameleon pair representing the same race, since the two real samples don't currently overlap on a shared race. Do not drift these formulas.

### Cross-source candidate matching

DDHQ uses `cand_id`, Chameleon uses its own choice `id`, and the VLM extractor will only have names. Within-source comparisons use `key`; cross-source comparisons fall back to normalized-name matching via `findMatchingCandidate` in `src/reconcile/reconcile.ts`. Normalization: lowercase → NFD → strip diacritics → strip non-alphanumeric.

### Surgical LLM boundary

Deterministic code does all polling, all DB queries, all reconciliation math, all severity assignment, all hysteresis. Vision is a plain Anthropic **Messages API** call (`@anthropic-ai/sdk`) — NOT the Agent SDK / Claude Code, which can't run a model locally, can't authenticate programmatically with a Pro/Max subscription, and is the wrong shape for a single-shot image→JSON task. An `ANTHROPIC_API_KEY` is required for live mode only; replay + `--stub-llm` need no key.

`extractFrame(frame)` (`src/vision/extractFrame.ts`) runs **two passes**, because the ✓/called glyph needs different handling than the bulk fields (proven by measurement):

1. **Pass 1 — bulk extraction. Haiku 4.5.** ONE call: full frame + the template registry as a menu (each template's `vlmPromptHint` + a forced-tool output schema) → an array of whichever templates are present, each with `singletons` + a `candidates` array. Multiple simultaneous surfaces fall out naturally. Each item becomes a `RaceObservation`. Duplicate detections de-duped; unknown template IDs dropped; format validators normalize ints/percents.
2. **Pass 2 — call detection (`calledFor` only). Sonnet 4.6, on an upscaled crop.** For each detected template with a `captureRegion`, crop to that region and upscale ~3× (`cropAndUpscaleRegion`), then re-read *only* which candidate has the ✓. Pass 1 already nails every other field; this pass overrides nothing but `calledFor`. Small crop, so Sonnet cost is modest and only fires on frames with a graphic. Tunable via `recallModel` / `recallVotes` (Haiku + 3 votes is an equivalent fallback).
3. **`judge(anomalyContext)`** — Sonnet 4.6, only when rules have already decided an anomaly is real. Can downgrade or annotate, never raise severity. Deferred until v1.1.

**Why two passes (measured, not assumed).** On the full 1920-wide frame all bulk fields read 30/30, but the small gold ✓ glyph read only ~37–60% (`race_heading` also dropped ~25% until its schema field was made required). Cropping+upscaling makes the ✓ large; **Sonnet single-shot on that crop = 20/20**. Measure reliability with `npm run verify` / `npm run measure-call` against a golden's ground truth — never trust count-only checks. **Resolution floor:** ticker vote totals legible at 1920-wide, mush at 1280 — do NOT downscale frames below ~1920 (the API's ~1.15MP auto-shrink, ≈1432×806, was tested and reads fine).

Opus 4.7/4.8 is not used. Prompt caching is enabled on the stable portion (the registry menu / tool schema, identical every frame). Goldens record every call of both passes, so `npm run capture-golden` freezes a frame and the replay test re-runs the full two-pass flow deterministically with **no API key**.

### Replay harness (the test backbone)

Recorder is always on in live mode. Every observation, every frame PNG, every LLM request/response goes to `recordings/<sessionId>.sqlite` keyed by `(frame hash, prompt hash)`. Replay player swaps the three source modules for replay sources; `--stub-llm` mode reuses recorded LLM responses for zero-cost deterministic runs. Golden replays under `recordings/goldens/` are the CI suite.

## Coding style

Carried over from the user's other TS/React work; defaults until said otherwise.

- **Arrow functions always.** `const foo = () => {}`, not `function foo() {}`. Exceptions: generators, hoisting required.
- **Named exports; `export default foo` only when a file exports a single value.** Never anonymous default exports.
- **No `any`.** Find the right type. Ask before resorting to `any`.
- **No lint / prettier / TS disables** without asking first.
- **Functional iteration** (`map`/`filter`/`reduce`/`find`) over `for...of` or `forEach + push`.
- **Don't destructure imports or props/objects unnecessarily.** `props.foo` and `React.useEffect` preferred — keeps origin visible.
- **Descriptive variable names.** `time` not `t`, `target` not `tgt`.
- **Omit braces** for single-statement functions and loops; **omit `return`** for immediate-return arrows.
- **Never JSX boolean shorthand.** Always `booleanProp={true}`.
- **Always type React components**: `const MyComponent: React.FC<Props> = (props) => ...`.
- **Don't worry about import sorting.** ESLint auto-fixes.

## Working style

- **Surface clever or complicated approaches before implementing them.** If a request seems to require a non-obvious abstraction, a clever state machine, or a tricky concurrency pattern, pause and lay out the tradeoff with a simpler alternative. The user prefers simple.
- **Pause at meaningful slice boundaries.** Don't drive ten modules in one go without checking back; ask "want me to push on or pause?" after a complete, testable slice.
- **Don't bombard with questions** during exploration — make reasonable calls and keep moving. Stop only when genuinely blocked (missing input, decision only the user can make).

## TypeScript conventions specific to this project

- `tsconfig.json` is strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`. Write code that respects these from the start.
- ESM project (`"type": "module"`). Imports use `.js` extensions even for `.ts` source (Node ESM resolution).
- **Zod only at source boundaries.** Provider/vendor JSON gets parsed through a zod schema; everything past that is pure typed TS. Internal modules don't validate; they trust types.
- **Adapters are pure.** Source-shape → `RaceObservation` is a deterministic transform. No I/O, no logging, no clock reads. Tests use real sample JSON.
- **Reconciler is pure.** All rules are functions over the three histories; hysteresis is applied at a higher layer that tracks emission history.
- **Store returns copies** (`[...list]`) so callers can't mutate internal state.

## Sample data and schema robustness

Current samples in repo root:

- `ddhq_response_example.json` — a 39-race paginated DDHQ response covering TX US House 2024-11-05 General Election (page 1, 10 races).
- `chameleon_response_example.json` — 49 contests from 2026-05-26 TX runoffs (Senate, House, Governor, AG, Lt Gov × Primary/Runoff/Special).

The two samples don't currently overlap on a shared race, so the cross-source race-key alignment test uses a synthetic pair (see `tests/chameleonAdapter.test.ts`). Before adding race-type-specific code (Presidential, statewide General, multi-winner Primary, Special Elections), drop a representative sample in the repo root and widen the schema tests so we know it parses. Cheap insurance.

Known fields not yet modeled (zod default strips them — won't crash, but the adapter can't surface them):

- DDHQ `ecvotes` (Presidential electoral votes)
- DDHQ `counties[]` (per-county breakdowns — rich data, ignored today)
- DDHQ `topline_results.voting_data` (absentee/election-day split)
- DDHQ `reporting_type`, `expected_winners`, `marquee_race`

## Known gaps / deferred work

These are deliberate v1 cuts, written down so they're not forgotten:

- **Presidential electoral votes.** Not in `RaceObservation`; can't reconcile EC-vote graphics. Add `electoralVotes?: number` field when an EC-vote template lands.
- **County-level reconciliation.** We adapt only the topline; county-detail graphics can't be cross-checked. Extend `RaceObservation` (or introduce `SubRaceObservation`) when needed.
- **Magic wall.** Plan accommodates it (`captureRegion?` + `dataPath: 'provider_direct'`) but locatable detection and dynamic-jurisdiction extraction are v1.1. User has a library of recordings that will become golden replays.
- **`judge()` LLM call.** Deferred until rule volume is known.
- **Slack / dashboard / paging sinks.** v1 is structured log + simple web view. Add only once severity tiers are trusted.
- **Provider poller endpoint + auth.** Adapter is ready; HTTP loop needs the actual DDHQ URL + auth scheme from the user.
- **Vendor SQL poller.** Adapter is ready; need to confirm whether the vendor exposes a queryable DB directly or only via this JSON response shape.
- **Multi-race concurrent monitoring.** Architecture supports it; runtime configures one race for MVP.
- **Auth on the web view.**

## Build order (per the plan)

types → store → reconciler with unit tests → adapters → recorder → replay player with stub sources → template specs + calibrate → **two-pass `extractFrame` + first golden** → real pollers → air capturer → wire `liveMain` → web view.

Currently done: project skeleton, types, store, reconciler + tests, both adapters (DDHQ + Ross) + tests against real samples, recorder + replay player + LLM stub scaffold + composition root, four template specs + registry + `calibrate`, **two-pass `extractFrame` (Haiku bulk + Sonnet call-recrop) verified live against all template families, first golden + hermetic replay test**. 83 tests passing.

Next up — all blocked on user inputs: real pollers (DDHQ endpoint+auth / Chameleon access pattern), air capturer (DirecTV screenshot mechanism), then wire `liveMain` + Fastify web view.

## Don't

- **Don't add features, refactors, or abstractions beyond what the task requires.** A bug fix doesn't need surrounding cleanup.
- **Don't add error handling, fallbacks, or validation for scenarios that can't happen.** Trust internal code and framework guarantees. Only validate at boundaries.
- **Don't add backwards-compat shims or `// removed` comments.** If something is unused, delete it.
- **Don't write comments that explain WHAT the code does** — well-named identifiers do that. Comment only WHY (hidden constraints, invariants, surprising behavior).
- **Don't drift the `composeRaceKey` formula** in any adapter. Always use the shared helper.
- **Don't reach for ML/CV classifiers** when a Haiku VLM call would do. Cost is bounded (~$25 per 6-hour broadcast).
- **Don't build a per-race state machine** for the reconciler. A flat observation list + pure rules is easier to replay and debug. Revisit only if rules start needing state context.

## References

- **Next steps / pick-up sheet**: [`NEXT_STEPS.md`](NEXT_STEPS.md)
- **Plan** (full architecture, MVP, deferred): [`docs/PLAN.md`](docs/PLAN.md)
- **Sample fixtures** in repo root: [`ddhq_response_example.json`](ddhq_response_example.json), [`chameleon_response_example.json`](chameleon_response_example.json)
- **Reconciler rules** with severity table and lag math: [`src/reconcile/reconcile.ts`](src/reconcile/reconcile.ts)
- **Template spec types**: [`src/templates/types.ts`](src/templates/types.ts)
- **Template spec worked example**: [`src/templates/tickerV1.ts`](src/templates/tickerV1.ts)
- **Race-key composition (shared invariant)**: [`src/sources/common.ts`](src/sources/common.ts)
- **Sibling project** for general TS/React/Puppeteer patterns (orthogonal domain — don't import its content): `/Users/jsanders/Developer/nn-toolbox` _(external, not in this repo)_
