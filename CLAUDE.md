# CLAUDE.md

Eagle Eye is an observer for live election-night TV graphics. It reconciles three independent streams — political provider API (DDHQ), graphics vendor DB (Chameleon), and on-air visual capture (DirecTV web player via a CDP-attached Chrome) — and flags inconsistencies for human review. Greenfield TypeScript/Node service.

## Quick start

```bash
npm install
npm test         # vitest run
npx tsc --noEmit
```

npm scripts are only for what a human types (`test`, `backend`, `frontend:*`, `chrome`); operator tasks like listing and pruning sessions live in the web view. Everything else runs directly: type check with `npx tsc --noEmit`, replay with `node --import tsx src/runtime/replayMain.ts <sessionId> [--serve] [--speed=N]`, and dev tools in `src/tools/`: `node --env-file-if-exists=.env --import tsx src/tools/<tool>.ts <args>` (the `.env` flag loads API keys; harmless for tools that need none). There are no lint/format scripts: `npx eslint --fix <changed files>`, hand-fix what's left, then `npx eslint .`. Don't add scripts back for convenience.

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
    provider/       DDHQ schema + adapter + OAuth paginated poller (queryStore = runtime race list)
    vendor/         Chameleon schema + adapter + poller (VPN-only playlist URL)
    air/            browserCapturer (puppeteer-core over CDP :9222) + captureScheduler + matchStore
  identity/         raceIdentity — cross-source race-linking (DDHQ canonical spine + provisional buckets + one-time Haiku proposal)
  vision/           extractFrame (two-pass VLM: Haiku bulk + Gemini crop read), llmClient, anthropicClient, googleClient, openRouterClient, retryingFetch, liveLlmClient (routes by model ID), goldenClient, cropRegion, redact
  tools/            calibrate / probe / capture-golden / verify (also the model-comparison harness) / measure-call / freeze-session / air-probe / probe-identity; usageMeter totals per-model cost for verify + measure-call
  store/            In-memory ring buffer per source with onRecord hook for recorder
  reconcile/        Pure triangulation + severity functions; thresholds in thresholds.ts
  settings/         settingsStore — persistent settings.sqlite (DDHQ query list + identity snapshot survive restarts)
  web/              Fastify JSON API + websocket push (server.ts, changeBus.ts) + Vite/React/MUI SPA (client/)
  replay/           Recorder + player + sessionGolden; recorder is sessions/observations/frames/llm_calls SQLite + content-addressed PNGs
  runtime/          composition.ts + liveMain.ts + replayMain.ts + anomalyTracker (emission/hysteresis — the alert layer, no separate alerts/ dir)
tests/              Vitest; reconciler rules + adapters + store + identity + frame & session goldens
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
	pctIn: number; // share of ESTIMATED turnout, not precincts — see below
	candidates: CandidateState[];
	calledFor: string[]; // candidate keys called/advancing; empty = none. A SET, order-insensitive.
	templateId?: string; // air only
	extractedFields?: Record<string, string>; // air only
};
```

`calledFor` is a **set of candidate keys**, not a single winner — top-two primaries/runoffs (and multi-seat races) genuinely call two. DDHQ uses all `called_candidates`; Chameleon all `elected` choices; the air extractor's recall pass reads every ✓. The reconciler's call rules compare it set-wise (order-insensitive), and flag `missing_call` when air shows a strict subset of the provider's called set (e.g. air caught only the leader's check mark in a two-winner race). The `recordings/goldens/fs_ga11_house_*` goldens lock this in.

`pctIn` is **a share of estimated turnout, not of precincts.** DDHQ reports progress two ways and names which per race in `reporting_type`: `estimated` → `topline_results.estimated_votes.turnout_mid` (total votes as a share of the modeled expected vote, revised through the night — so it can legitimately _fall_ while votes keep rising, e.g. when early turnout beats the forecast), `precincts` → `topline_results.precincts.percent` (municipal races only). Every race in scope is `estimated`. Chameleon's `dbVotesPercent` is its copy of `turnout_mid` and is what the Nov 3 template renders as `% IN`; its `polls.reportedPercent` is the precinct figure and is not used. (June 2026 evidence: the air badge showed 78/81/65/76 while our precinct-based vendor figure said 67/75/77/85 — the three June `pct_in_mismatch` alerts were this.) Never add a rule that treats `pctIn` as monotonic.

### `TemplateSpec`

Declarative description of an on-air template — what it looks like and what to read off it, NOT pixel coordinates for each field. The VLM localizes fields itself within the crop. Each spec has:

- `captureRegion?` — ONE loose region (as normalized `{x,y,w,h}` fractions in `[0..1]`, resolution-independent via `scaleRectToFrame`) that contains the whole graphic. Not a per-field map — it's the crop the pass-2 call-detection re-reads (upscaled). Absent for locatable templates (magic wall), where detection returns a bbox.
- `vlmPromptHint` — prose telling the model what the surface looks like (used as the per-template entry in the extract-all menu).
- `singletons` — single-valued fields the model reads (e.g. `race_heading`, `pct_in`). No rects.
- `candidateList?` — the reflowing candidate cards. The model returns an **array** of whatever length is on screen, so the spec is agnostic to candidate count; the current package always shows exactly two. `layout: 'row' | 'column'`.
- `bind` — `raceKeyFrom(singletons)` and `candidateKeyFrom(candidate)`.

Three real specs exist (`fullscreenResults`, `lowerThird`, `tickerV1`), authored against the September 2026 package's reference frames in `recordings/reference-frames/` (see its README for layout bands and ground truth). The fullscreen + lower-third layer has **two geometries** — native (layer exports) and on-air (scaled 0.979 in y from the top, shifted up 42 px; the ticker stays put). The fullscreen may appear natively on a test feed and reads fine either way (measured); the lower third only ever airs shifted, since natively it would overlap the always-on ticker, so its `captureRegion` is authored to the on-air band only. The side slab was retired 2026-09-25 (may return; restore from git history). The ticker FLIPS between races (one race per flip; not a scroll), so fixed regions hold. Per-field pixel rects and pixel/color fingerprints were removed — they were brittle and the VLM doesn't need them.

`dataPath` is either `'vendor'` (3-source reconciliation: DDHQ + Ross + air) or `'provider_direct'` (2-source: DDHQ + air — for the magic wall, which bypasses Ross).

### Race-key composition (load-bearing invariant)

All sources MUST produce the same `raceKey` for the same political race. Use `composeRaceKey()` in `src/sources/common.ts`. The formula is `${year}-${state}-${slugify(office)}-${district||'AL'}-${slugify(party)||'NP'}-${slugify(contestType)}`.

A regression test (`tests/chameleonAdapter.test.ts` → "cross-source race key alignment") asserts this against a synthetic DDHQ + Chameleon pair representing the same race, since the two real samples don't currently overlap on a shared race. Do not drift these formulas.

### Cross-source candidate matching

DDHQ uses `cand_id`, Chameleon uses its own choice `id`, and the VLM extractor will only have names. Within-source comparisons use `key`; cross-source comparisons fall back to normalized-name matching via `findMatchingCandidate` in `src/reconcile/reconcile.ts`. Normalization: lowercase → NFD → strip diacritics → strip non-alphanumeric.

### Surgical LLM boundary

Deterministic code does all polling, all DB queries, all reconciliation math, all severity assignment, all hysteresis. Vision is a plain Anthropic **Messages API** call (`@anthropic-ai/sdk`) — NOT the Agent SDK / Claude Code, which can't run a model locally, can't authenticate programmatically with a Pro/Max subscription, and is the wrong shape for a single-shot image→JSON task. An `ANTHROPIC_API_KEY` is required for live mode only; replay + `--stub-llm` need no key.

`makeLiveLlmClient` (`src/vision/liveLlmClient.ts`) is the one client every live tool builds, and the model ID picks the backend. A native Google ID (`gemini-3.8-flash`) goes straight to **Google's Interactions API** through `googleClient.ts` — inline image part, function tool forced by `tool_choice`, `thinking_level: 'low'` by default, `store: false`, thought tokens folded into output usage, same two-retry policy (shared `retryingFetch.ts`). A model ID containing a slash (`google/gemini-3.8-flash`, `deepseek/deepseek-v4.1-flash`) is routed to **OpenRouter** through `openRouterClient.ts` — OpenAI chat-completions dialect, image as a data URL, the reporting tool as a forced function call, `provider.require_parameters` so a provider that would ignore `tool_choice` is never chosen, two retries on dropped connections / 429 / 5xx, and OpenRouter's per-response USD cost surfaced on `LlmResponse.usage`; everything else goes to Anthropic direct. `missingLiveKeys(models)` names the env vars the requested models need (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`) that are unset; live mode out of the box needs the first two — pass 1 is Haiku on Anthropic, the crop read is Gemini direct. OpenRouter is only for trials of other vendors. Both backends sit behind the same `LlmClient` interface, so recording/replay is unchanged (the prompt hash already includes the model). Qwen models are not usable this way: no OpenRouter provider honors a forced `tool_choice` for them.

`extractFrame(frame)` (`src/vision/extractFrame.ts`) runs **two passes**, because the ✓/called glyph needs different handling than the bulk fields (proven by measurement):

1. **Pass 1 — bulk extraction. Haiku 4.5.** ONE call: full frame + the template registry as a menu (each template's `vlmPromptHint` + a forced-tool output schema) → an array of whichever templates are present, each with `singletons` + a `candidates` array. Multiple simultaneous surfaces fall out naturally. Each item becomes a `RaceObservation`. Duplicate detections de-duped; unknown template IDs dropped; format validators normalize ints/percents.
2. **Pass 2 — the crop read. Gemini 3.8 Flash at low thinking, called directly on Google's Interactions API (Sonnet 4.6 is the Anthropic-only fallback), on the template's region crop.** For each detected template with a `captureRegion`, crop to that region (`cropAndUpscaleRegion`, sized to the API's standard-tier limits — 1568 px long edge / 1568 visual tokens — since anything larger is downsized server-side and a 3× upscale once blew the 10 MB image limit) and re-read the small print: votes, pct, the ✓, the `% IN` badge, and the heading. **Pass 1 keeps the roster** (names/keys — it reads full names reliably; the crop read tends to return one of the two stacked name lines); crop rows are matched back by position, then partial name. The crop read also self-corrects pass 1's template label: reads are cached per _region_ for the frame, and a roster that its own region's crop doesn't show is matched against the other regions (pass 1 occasionally swaps the ticker and lower-third labels). A roster no region shows is dropped. The crop read's heading wins for the race key (pass 1 sometimes folds the badge into it). Tunable via `recallModel` / `recallVotes`.
3. **`judge(anomalyContext)`** — Sonnet 4.6, only when rules have already decided an anomaly is real. Can downgrade or annotate, never raise severity. Deferred until v1.1.

**Why two passes (measured, not assumed).** On the full 1920-wide frame all bulk fields read 30/30, but the small gold ✓ glyph read only ~37–60% (`race_heading` also dropped ~25% until its schema field was made required). Isolating the graphic in its own crop is what fixes it — **Sonnet single-shot on the region crop = 20/20** called and 20/20 uncalled on the September 2026 package (ticker, lower-third, fullscreen). The 2026-09-26 model trial (`NEXT_STEPS.md`) then measured **Gemini 3.8 Flash at low reasoning at the same 160/160 on the eight hardest goldens and 46/46 on all 23, at 42% of Sonnet 4.6's cost** (≈ $6/h vs ≈ $14/h at the 5 s cadence), so it is the default crop reader, called directly on Google (the OpenRouter-routed form of the same model measured identically; direct spot-check in `NEXT_STEPS.md`); Sonnet 5 regressed (153/160) and every cheaper model either invented the `% IN` badge or hallucinated a ✓. Measure reliability with `node --env-file-if-exists=.env --import tsx src/tools/verifyExtraction.ts` / `src/tools/measureCall.ts` against a golden's ground truth — never trust count-only checks. `node --env-file-if-exists=.env --import tsx src/tools/verifyExtraction.ts all 2 --model X --recall-model Y [--reasoning E]` is the **model-comparison harness**: exact-reproduction rate per golden, drift tallied by field, errors counted separately, and the measured cost per model, per frame and per broadcast hour; pass 1 and the crop read can be pointed at different models and different backends. **Resolution floor:** ticker vote totals legible at 1920-wide, mush at 1280 — do NOT downscale frames below ~1920 (the API's ~1.15MP auto-shrink, ≈1432×806, was tested and reads fine).

Opus 4.7/4.8 is not used. **Prompt caching is NOT used** — measured, the stable prefix (tools + menu) is ~1,200 tokens, below Haiku 4.5's 4,096-token cache floor, and the per-frame image (~1,560 tokens, most of the cost) is unique and uncacheable. The cost lever is capture cadence (don't extract every frame), not caching. Goldens record every call of both passes, so `node --env-file-if-exists=.env --import tsx src/tools/captureGolden.ts` freezes a frame and the replay test re-runs the full two-pass flow deterministically with **no API key**.

### Replay harness (the test backbone)

Recorder is always on in live mode. Every observation, every frame PNG, every LLM request/response, and every identity event goes to `recordings/<sessionId>.sqlite` keyed by `(frame hash, prompt hash)`. Replay player swaps the three source modules for replay sources; `--stub-llm` mode reuses recorded LLM responses for zero-cost deterministic runs. Golden replays are the CI suite, in **two kinds**:

- **Frame goldens** (`recordings/goldens/*.golden.json` + PNG) — one image + its recorded two-pass LLM responses; regression for `extractFrame`. `node --env-file-if-exists=.env --import tsx src/tools/captureGolden.ts <framePng> <name>` freezes one live; `--from-session <sessionId> <frameHash> <name>` freezes one from a recorded session's frames + responses (**no API key**). Two real broadcast frames now sit alongside the synthetic ones.
- **Session goldens** (`recordings/goldens/sessions/*.session.json`) — `src/replay/sessionGolden.ts` `replaySessionTimeline` replays a whole recorded timeline in its original poll batches, applies recorded identity events as mid-timeline rekeys, and freezes what the store + reconciler emit (distinct-anomaly set, final anomalies, identity + store summaries). `node --import tsx src/tools/freezeSessionGolden.ts <sessionId> <name>` writes the self-contained doc (session sqlites stay gitignored); `--refreeze <goldenFile>` recomputes expectations from the doc's own inputs after an intentional rule change. `tests/replay/sessionGoldens.test.ts` runs them hermetically. First one: `tx_runoffs_2026-06-01_all_sources` (64 min, 4,147 obs, all three sources).

**API recording + playback live in the sibling repo `elex_sim`.** It records the raw DDHQ and Chameleon GETs and plays a recording back on mirror endpoints serving the same paths. The **Sim** DDHQ environment (Setup tab, alongside Production and Integration) points both pollers at it (`SIM_BASE_URL`, default `http://localhost:8788`) with placeholder DDHQ credentials. Nothing else changes: the query list must match the recording's, playback is 1× only, and Sim race links persist to `settings.sqlite` like live ones. elex_sim will also serve a simulated 1920×1080 air feed for the capturer to target by URL match; it isn't built yet.

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
- `ddhq_response_general_example.json` — page 1 of `race_date=2026-11-03&state=TX&office_id=3` as served on 2026-09-26 (`test_data: true` races; pre-election `precincts.percent` is **null**).
- `chameleon_response_example.json` — 49 contests from 2026-05-26 TX runoffs (Senate, House, Governor, AG, Lt Gov × Primary/Runoff/Special).
- `chameleon_response_general_example.json` — 13 contests sliced from the live 2026-11-03 playlist: every `area` shape seen, a 3-candidate statewide, a ballot question, a special, and the `General` (not `General Election`) contest type.

The two General samples overlap on TX-9 (DDHQ race 295078 ↔ Chameleon contest 90203), so the cross-source race-key alignment test runs on a real pair as well as the synthetic one (see `tests/chameleonAdapter.test.ts`). Live on 2026-09-26, all 119 Nov 3 Chameleon contests keyed identically to the DDHQ races they point at. Before adding race-type-specific code (Presidential, multi-winner Primary, ranked choice), drop a representative sample in the repo root and widen the schema tests so we know it parses. Cheap insurance.

Two live-data shapes the schemas were widened for on 2026-09-26 (both broke a poll tick outright before): DDHQ's `next_page_url` has no scheme and names a different host, so the poller re-bases it onto `DDHQ_BASE_URL`; Chameleon's `area.State`/`District`/`County` are dynamic fields that are usually absent on the General playlist, and the built-in lowercase `state`/`district`/`county` carry the data.

Known fields not yet modeled (zod default strips them — won't crash, but the adapter can't surface them):

- DDHQ `ecvotes` (Presidential electoral votes)
- DDHQ `counties[]` (per-county breakdowns — rich data, ignored today)
- DDHQ `topline_results.voting_data` (absentee/election-day split)
- DDHQ `expected_winners`, `marquee_race`, `test_data`
- Chameleon `contest.raceID` — the DDHQ `race_id`, set on every Nov 3 contest. Would make Ross→DDHQ race linking deterministic (no Haiku proposal); not wired yet.

## Known gaps / deferred work

These are deliberate v1 cuts, written down so they're not forgotten:

- **Presidential electoral votes.** Not in `RaceObservation`; can't reconcile EC-vote graphics. Add `electoralVotes?: number` field when an EC-vote template lands.
- **County-level reconciliation.** We adapt only the topline; county-detail graphics can't be cross-checked. Extend `RaceObservation` (or introduce `SubRaceObservation`) when needed.
- **Magic wall.** Plan accommodates it (`captureRegion?` + `dataPath: 'provider_direct'`) but locatable detection and dynamic-jurisdiction extraction are v1.1. User has a library of recordings that will become golden replays.
- **`judge()` LLM call.** Deferred until rule volume is known.
- **Slack / dashboard / paging sinks.** v1 is structured log + web view (`anomalyTracker` + `RaceLinks`/`Alerts`). Add only once severity tiers are trusted.
- **Multi-race concurrent monitoring.** Architecture supports it; runtime configures the tracked set via the DDHQ query list.
- **Auth on the web view.**

## Build order (per the plan)

types → store → reconciler with unit tests → adapters → recorder → replay player with stub sources → template specs + calibrate → **two-pass `extractFrame` + first golden** → real pollers → air capturer → wire `liveMain` → web view.

Currently done: **the entire build order above, plus the identity resolver, live pollers, the air capturer, `liveMain`, the Fastify + websocket web view, and session goldens.** Proven live against two June 2026 broadcast nights (TX runoffs with all three sources + a DDHQ/Ross primary night). **276 tests passing.**

Next up — see [`NEXT_STEPS.md`](NEXT_STEPS.md) for the current list: the rehearsal with all three sources, deterministic Ross→DDHQ linking via Chameleon's `raceID`, then the still-deferred items below.

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
