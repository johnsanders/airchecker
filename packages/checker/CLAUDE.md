# checker (Eagle Eye)

Repo-wide conventions (coding style, working style, TypeScript rules, lint, the root `.env`) are in the [root CLAUDE.md](../../CLAUDE.md). Everything here assumes cwd `packages/checker`.

Eagle Eye is an observer for live election-night TV graphics. It reconciles three independent streams — political provider API (DDHQ), graphics vendor DB (Chameleon), and on-air visual capture (DirecTV web player via a CDP-attached Chrome) — and flags inconsistencies for human review. Greenfield TypeScript/Node service.

## Quick start

```bash
npm test                  # this package only (npm test at the repo root runs both)
npm run frontend:build    # once, and after client changes
npm run backend           # live system + web view on :8787
npm run frontend:dev      # hot-reload web view on :5173, proxied to :8787
```

npm scripts are only for what a human types (`test`, `backend`, `frontend:*`, `chrome`); operator tasks like listing and pruning sessions live in the web view. Everything else runs directly from this directory: replay with `node --import tsx src/runtime/replayMain.ts <sessionId> [--serve] [--speed=N]`, and dev tools in `src/tools/`: `node --env-file-if-exists=../../.env --import tsx src/tools/<tool>.ts <args>` (the flag loads API keys from the root `.env`; harmless for tools that need none). Don't add scripts back for convenience.

## Architecture

Single Node service. Three long-running loops feed one shared store. Each graphic read off air is checked once, against what Ross and DDHQ had said by the time it was read; surgical LLM calls handle vision; an always-on recorder makes replay the test backbone.

```
provider API   →  providerPoller  ─┐
vendor DB      →  vendorPoller    ─┼→  link to its race  →  Store (per source, per race)
DirecTV window →  airCapturer     ─┤                           ↓  on each air read
                  └─ extractFrame (each template's region of the frame cropped and
                     read on its own by Gemini)
                                                               ↓
                                        Reconciler, as of the read  →  alert log + web view
```

`src/runtime/composition.ts` is that whole pipeline, and live, replay and the session goldens all run it.

Full plan (architecture rationale, MVP scope, deferred work, verification approach): [`docs/PLAN.md`](docs/PLAN.md).

## Project layout

```
src/
  templates/        TemplateSpec types + one spec file per on-air template
  sources/
    common.ts       Shared race-key composition + party-letter mapping (MUST be shared so keys align across sources)
    provider/       DDHQ schema + adapter + OAuth paginated poller (queryStore = runtime race list)
    vendor/         Chameleon schema + adapter + poller (VPN-only playlist URL)
    air/            browserCapturer (puppeteer-core over CDP :9222; pins the tab's viewport to 1920×1080 at 1×, so every frame is a full 16:9 1920×1080; opens the tab when none matches: the simulator's /air/ in Sim, the DirecTV player for Live's DirecTV preset) + captureScheduler + matchStore
  identity/         linkRace: which race an observation is about, a pure lookup against the races known so far (Ross by the DDHQ `race_id` its Chameleon contest names; air by its heading's state/office/district/party when exactly one race fits and its ballot has a surname the graphic shows, airHeading.ts). Nothing is remembered or persisted, and no model is asked
  vision/           extractFrame (each template's region cropped and read by Gemini), llmClient, anthropicClient, googleClient, openRouterClient, retryingFetch, liveLlmClient (routes by model ID), goldenClient, cropRegion, redact
  tools/            calibrate / probe / capture-golden / verify (also the model-comparison harness) / measure-call / freeze-session / air-probe; usageMeter totals per-model cost for verify + measure-call
  store/            In memory, per source per race, with an onRecord hook for the recorder. Every air read is kept for 30 minutes; DDHQ and Ross are kept only when what they say changes
  reconcile/        Pure rules over an air read and what the sources had said by then; thresholds in thresholds.ts
  settings/         settingsStore — persistent settings.sqlite (the DDHQ query list, mode, DDHQ host and air tab survive restarts)
  web/              Fastify JSON API + websocket push (server.ts, changeBus.ts) + Vite/React/MUI SPA (client/)
  replay/           Recorder + player + sessionGolden; recorder is sessions/observations/frames/llm_calls SQLite + content-addressed PNGs
  runtime/          composition.ts (the pipeline: link, store, check each air read, alert log) + liveMain.ts + replayMain.ts + alertLog
tests/              Vitest; reconciler rules + adapters + store + linking + the pipeline + frame & session goldens
```

Sample fixtures (real responses, kept in this package's root):

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
};
```

`calledFor` is a **set of candidate keys**, not a single winner — top-two primaries/runoffs (and multi-seat races) genuinely call two. DDHQ uses all `called_candidates`; Chameleon all `elected` choices; the air extractor reads every ✓. The reconciler's call rules compare it set-wise (order-insensitive), and flag `missing_call` when air shows a strict subset of the provider's called set (e.g. air caught only the leader's check mark in a two-winner race). The `recordings/goldens/fs_ga11_house_*` goldens lock this in.

`pctIn` is **a share of estimated turnout, not of precincts.** DDHQ reports progress two ways and names which per race in `reporting_type`: `estimated` → `topline_results.estimated_votes.turnout_mid` (total votes as a share of the modeled expected vote, revised through the night — so it can legitimately _fall_ while votes keep rising, e.g. when early turnout beats the forecast), `precincts` → `topline_results.precincts.percent` (municipal races only). Every race in scope is `estimated`. Chameleon's `dbVotesPercent` is its copy of `turnout_mid` and is what the Nov 3 template renders as `% IN`; its `polls.reportedPercent` is the precinct figure and is not used. (June 2026 evidence: the air badge showed 78/81/65/76 while our precinct-based vendor figure said 67/75/77/85 — the three June `pct_in_mismatch` alerts were this.) Never add a rule that treats `pctIn` as monotonic.

### An air read is a record

The product is one list: the graphics read off air, each beside what Ross and DDHQ said, and what's wrong with it. Everything about a read is settled when it is read and never changes after:

- **It is checked once, as of the read.** `composition.ingest` links and stores a batch, then checks each air read in it against the sources' histories up to the read's `observedAt`. A DDHQ or Ross poll is never checked on its own; it only adds to what later reads are held against. So a mismatch stays a mismatch after the source catches up.
- **It is held against one Ross state**: of the states Ross was in during the 35 s before the read (the one it was already in when that window opened included), the one the graphic disagrees with least. A graphic is drawn from one state, so its votes and its `% IN` must both come from it. With no state in the window the last one Ross was in stands, so no read goes unchecked.
- **Ross is polled every 5 s**, faster than its state reaches air (8–30 s). Polled slower, air shows figures we haven't seen and a correct graphic reads as a mismatch. DDHQ is polled every 60 s, which is slower than a call reaches air, so a ✓ the graphic could have drawn from Ross is never `premature_call`.
- **The store keeps DDHQ and Ross only when what they say changes**, stamped when first seen, so the last entry at or before a moment is what the source was saying then. It keeps them 5 minutes longer than air reads, and always the latest of each race.
- **Each monitoring start begins from nothing** (`composition.reset`): because the latest of each race is always kept, a Sim rehearsal's figures would otherwise stand in a Live session for any race not yet reported again.
- **Alerts are per graphic.** The alert log raises what a read found that the previous read of that race on that template didn't, and clears what it no longer finds. There is no hysteresis: a single bad graphic alerts when seen (decision, 2026-09-25).
- **The web view** lists each race once as its latest read (`/api/races`); when one frame shows a race on two graphics, the one with something wrong stands for it. A race's dialog lists every read of it.

### `TemplateSpec`

An on-air template: where it sits in the frame and what it looks like, NOT pixel coordinates for each field. The VLM finds the fields itself within the crop. Each spec has an `id`, a `surface`, and:

- `captureRegion` — ONE loose region (as normalized `{x,y,w,h}` fractions in `[0..1]`, resolution-independent via `scaleRectToFrame`) that contains the whole graphic. Not a per-field map — it's the crop that is read, on every frame.
- `vlmPromptHint` — prose telling the model what the graphic looks like and what else may sit in its region (chyrons, promos). It is part of the measured prompt: changing it means measuring again and recording the frame goldens again.

What's read off a graphic is the same for every template (the heading, the `% IN`, each candidate's two name lines, party, percent, votes and ✓), and the race key comes from the printed heading (`headingRaceKey`). The candidates are whatever cards the model finds, so a spec says nothing about how many there are or how they're laid out; the current package always shows exactly two.

Three real specs exist (`fullscreenResults`, `lowerThird`, `tickerV1`), authored against the September 2026 package's reference frames in `recordings/reference-frames/` (see its README for layout bands and ground truth). The fullscreen + lower-third layer has **two geometries** — native (layer exports) and on-air (scaled 0.979 in y from the top, shifted up 42 px; the ticker stays put). The fullscreen may appear natively on a test feed and reads fine either way (measured); the lower third only ever airs shifted, since natively it would overlap the always-on ticker, so its `captureRegion` is authored to the on-air band only. The side slab was retired 2026-09-25 (may return; restore from git history). The ticker FLIPS between races (one race per flip; not a scroll), so fixed regions hold. Per-field pixel rects and pixel/color fingerprints were removed — they were brittle and the VLM doesn't need them.

### Race-key composition (load-bearing invariant)

All sources MUST produce the same `raceKey` for the same political race. Use `composeRaceKey()` in `src/sources/common.ts`. The formula is `${year}-${state}-${slugify(office)}-${district||'AL'}-${slugify(party)||'NP'}-${slugify(contestType)}`.

A regression test (`tests/chameleonAdapter.test.ts` → "cross-source race key alignment") asserts this against a synthetic DDHQ + Chameleon pair representing the same race, since the two real samples don't currently overlap on a shared race. Do not drift these formulas.

### Cross-source candidate matching

DDHQ uses `cand_id`, Chameleon uses its own choice `id`, and the VLM extractor will only have names. Within-source comparisons use `key`; cross-source comparisons fall back to normalized-name matching via `findMatchingCandidate` in `src/reconcile/reconcile.ts`. Normalization: lowercase → NFD → strip diacritics → strip non-alphanumeric.

### Surgical LLM boundary

Deterministic code does all polling, all DB queries, all reconciliation math, all severity assignment. Vision is a plain single-shot image→JSON call with a forced tool — NOT the Agent SDK / Claude Code, which is the wrong shape for it. A `GEMINI_API_KEY` is required for live mode only; replay and the goldens need no key.

`makeLiveLlmClient` (`src/vision/liveLlmClient.ts`) is the one client every live tool builds, and the model ID picks the backend. A native Google ID (`gemini-3.8-flash`) goes straight to **Google's Interactions API** through `googleClient.ts` — inline image part, function tool forced by `tool_choice`, `thinking_level: 'low'` by default, `store: false`, thought tokens folded into output usage, two retries (shared `retryingFetch.ts`). A model ID containing a slash (`google/gemini-3.8-flash`, `deepseek/deepseek-v4.1-flash`) is routed to **OpenRouter** through `openRouterClient.ts` — OpenAI chat-completions dialect, image as a data URL, the reporting tool as a forced function call, `provider.require_parameters` so a provider that would ignore `tool_choice` is never chosen, and OpenRouter's per-response USD cost surfaced on `LlmResponse.usage`; everything else goes to Anthropic direct. `missingLiveKeys(models)` names the env vars the requested models need (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`) that are unset; live mode out of the box needs only the first. Anthropic and OpenRouter are for trials of other readers. All backends sit behind the same `LlmClient` interface, so recording/replay is unchanged (the prompt hash already includes the model). Qwen models are not usable this way: no OpenRouter provider honors a forced `tool_choice` for them.

`extractFrame(frame)` (`src/vision/extractFrame.ts`) reads **each template's region on its own**. Every template sits in a fixed region of the frame, so on every frame each region is cropped (`cropAndUpscaleRegion`, sized to the API's standard-tier limits — 1568 px long edge / 1568 visual tokens — since anything larger is downsized server-side and a 3× upscale once blew the 10 MB image limit) and read by one call to **Gemini 3.8 Flash at low thinking**, which is told which graphic the region holds when it holds any and that it may hold none. What comes back becomes that template's observation: the race key from the printed heading, the name from its two printed lines (asked for one name field, the model returned one line often enough to lose legible tickers), the `% IN` with its `>` floor or its absence, votes, percent and every ✓. A region showing no graphic yields nothing. Guards drop a read that isn't a whole graphic: a name that isn't first and last, a placeholder, a heading that doesn't open with a state, a share with no votes (the mid-flip signatures). One failed read fails the frame. Every read is recorded under the hash of the frame it came from. `judge()`, a second opinion on an anomaly the rules have already raised, is still deferred.

**Why crops, and why only crops (measured, not assumed).** On the full 1920-wide frame the small gold ✓ glyph read only ~37–60% and small ticker digits were misread; isolating the graphic in its own crop is what fixes it (Sonnet single-shot on the region crop = 20/20 called and 20/20 uncalled). Until 2026-09-29 a full-frame pass by Haiku 4.5 ran first, to say which graphics were on the frame and to own their names, and the crop reads then filled in the small print. Measured that day against reading the three regions directly: all 23 frame goldens × 3 and the 8 hardest × 20 exact either way; on 50 frames of the simulator's air, 74 of 74 graphics found with every field right, where two passes found 71 and misread a name (the full-frame pass called the lower third the ticker on 9 of 10 frames and read "Amy Acton" as "Amy Action"); ≈ $4 an hour at the 5 s cadence against ≈ $6. Sonnet 4.6 reads the crops as well at ≈ $19 an hour. The 2026-09-26 model trial (`NEXT_STEPS.md`) is why the reader is Gemini 3.8 Flash at low reasoning: Sonnet 5 regressed (153/160) and every cheaper model either invented the `% IN` badge or hallucinated a ✓. Measure reliability with `node --env-file-if-exists=../../.env --import tsx src/tools/verifyExtraction.ts` / `src/tools/measureCall.ts` against a golden's ground truth — never trust count-only checks. `node --env-file-if-exists=../../.env --import tsx src/tools/verifyExtraction.ts all 2 --model X [--reasoning E]` is the **model-comparison harness**: exact-reproduction rate per golden, drift tallied by field, errors counted separately, and the measured cost per model, per frame and per broadcast hour. **Resolution floor:** ticker vote totals legible at 1920-wide, mush at 1280 — do NOT downscale frames below ~1920. Not yet measured on real air: the goldens are single frames and the simulator's graphics are copies.

**Prompt caching is NOT used** — the image, most of the cost, is unique to each call and uncacheable. The cost lever is capture cadence (don't read every frame), not caching. Goldens record every region's read, so `node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts` freezes a frame and the replay test re-runs the extraction deterministically with **no API key**.

### Replay harness (the test backbone)

Recorder is always on in live mode. Every observation the store keeps, every frame PNG, every LLM request/response, and every alert event goes to `recordings/<sessionId>.sqlite` keyed by `(frame hash, prompt hash)`. Replay player swaps the three source modules for replay sources; `--stub-llm` mode reuses recorded LLM responses for zero-cost deterministic runs. Golden replays are the CI suite, in **two kinds**:

- **Frame goldens** (`recordings/goldens/*.golden.json` + PNG) — one image + the recorded read of each of its regions; regression for `extractFrame`. `node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts <framePng> <name>` freezes one live; `--from-session <sessionId> <frameHash> <name>` freezes one from a recorded session's frames + responses (**no API key**), for sessions recorded since the reads changed (2026-09-29). All 23 were recorded again that day, each reproducing what it already expected.
- **Session goldens** (`recordings/goldens/sessions/*.session.json`) — `src/replay/sessionGolden.ts` `replaySessionTimeline` runs a whole recorded timeline through the pipeline in its original poll batches, linking every observation afresh from its source key, and freezes what comes out (alert events, the distinct-anomaly set, what stands at the end, how many aired races linked, what the store holds). `node --import tsx src/tools/freezeSessionGolden.ts <sessionId> <name>` writes the self-contained doc (session sqlites stay gitignored); `--refreeze <goldenFile>` recomputes expectations from the doc's own inputs after an intentional rule change. `tests/replay/sessionGoldens.test.ts` runs them hermetically. First one: `tx_runoffs_2026-06-01_all_sources` (64 min, 4,147 obs, all three sources).

**Live / Sim mode** (app bar; `mode` in settings.sqlite; locked while monitoring). Live polls DDHQ on the chosen host (`ddhq_environment`: production or integration) with the saved query list, Chameleon's blade, and the saved air tab. Sim points all three at the [simulator package](../simulator/CLAUDE.md) (`SIM_BASE_URL`, default `http://localhost:8788`): DDHQ and Chameleon on its mirror with placeholder DDHQ credentials, the DDHQ queries fetched from its `/api/sim/queries` each poll, and air captured from its `/air/` page. The simulator serves either an invented night behind all three sources (lagged like the real pipeline: Chameleon 30 s behind DDHQ, graphics 19 s behind Chameleon) or a recorded night's API responses at 1×. Each session's `meta` records its mode. `src/tools/scoreSimAir.ts <sessionId>` scores a Sim session's air reads against what the simulator says aired.

## Conventions specific to this package

- **Adapters are pure.** Source-shape → `RaceObservation` is a deterministic transform. No I/O, no logging, no clock reads. Tests use real sample JSON.
- **Reconciler is pure.** All rules are functions over the three histories as they stood at the air read being checked.
- **Store returns copies** (`[...list]`) so callers can't mutate internal state.

## Sample data and schema robustness

Current samples in this package's root:

- `ddhq_response_example.json` — a 39-race paginated DDHQ response covering TX US House 2024-11-05 General Election (page 1, 10 races).
- `ddhq_response_general_example.json` — page 1 of `race_date=2026-11-03&state=TX&office_id=3` as served on 2026-09-26 (`test_data: true` races; pre-election `precincts.percent` is **null**).
- `chameleon_response_example.json` — 49 contests from 2026-05-26 TX runoffs (Senate, House, Governor, AG, Lt Gov × Primary/Runoff/Special).
- `chameleon_response_general_example.json` — 13 contests sliced from the live 2026-11-03 playlist: every `area` shape seen, a 3-candidate statewide, a ballot question, a special, and the `General` (not `General Election`) contest type.

The two General samples overlap on TX-9 (DDHQ race 295078 ↔ Chameleon contest 90203), so the cross-source race-key alignment test runs on a real pair as well as the synthetic one (see `tests/chameleonAdapter.test.ts`). Live on 2026-09-26, all 119 Nov 3 Chameleon contests keyed identically to the DDHQ races they point at. Before adding race-type-specific code (Presidential, multi-winner Primary, ranked choice), drop a representative sample in this package's root and widen the schema tests so we know it parses. Cheap insurance.

Two live-data shapes the schemas were widened for on 2026-09-26 (both broke a poll tick outright before): DDHQ's `next_page_url` has no scheme and names a different host, so the poller re-bases it onto `DDHQ_BASE_URL`; Chameleon's `area.State`/`District`/`County` are dynamic fields that are usually absent on the General playlist, and the built-in lowercase `state`/`district`/`county` carry the data.

Known fields not yet modeled (zod default strips them — won't crash, but the adapter can't surface them):

- DDHQ `ecvotes` (Presidential electoral votes)
- DDHQ `counties[]` (per-county breakdowns — rich data, ignored today)
- DDHQ `topline_results.voting_data` (absentee/election-day split)
- DDHQ `expected_winners`, `marquee_race`, `test_data`

## Known gaps / deferred work

These are deliberate v1 cuts, written down so they're not forgotten:

- **Presidential electoral votes.** Not in `RaceObservation`; can't reconcile EC-vote graphics. Add `electoralVotes?: number` field when an EC-vote template lands.
- **County-level reconciliation.** We adapt only the topline; county-detail graphics can't be cross-checked. Extend `RaceObservation` (or introduce `SubRaceObservation`) when needed.
- **Magic wall.** Not started: it bypasses Ross, so it is held against DDHQ directly, and it needs locatable detection and dynamic-jurisdiction extraction. User has a library of recordings that will become golden replays.
- **`judge()` LLM call.** Deferred until rule volume is known.
- **Slack / dashboard / paging sinks.** v1 is structured log + web view (`alertLog`, the On air list). Add only once severity tiers are trusted.
- **Multi-race concurrent monitoring.** Architecture supports it; runtime configures the tracked set via the DDHQ query list.
- **Auth on the web view.**

## Build order (per the plan)

types → store → reconciler with unit tests → adapters → recorder → replay player with stub sources → template specs + calibrate → **`extractFrame` + first golden** → real pollers → air capturer → wire `liveMain` → web view.

Currently done: **the entire build order above (the extractor since rewritten to read each region on its own), plus race linking, live pollers, the air capturer, `liveMain`, the Fastify + websocket web view, and session goldens.** Proven live against two June 2026 broadcast nights (TX runoffs with all three sources + a DDHQ/Ross primary night). **286 tests passing.**

Next up — see [`NEXT_STEPS.md`](NEXT_STEPS.md) for the current list: the rehearsal with all three sources, then the still-deferred items below.

## Don't (in addition to the root list)

- **Don't drift the `composeRaceKey` formula** in any adapter. Always use the shared helper.
- **Don't reach for ML/CV classifiers** when a VLM call would do. Cost is bounded (~$25 per 6-hour broadcast).
- **Don't build a per-race state machine** for the reconciler. A flat observation list + pure rules is easier to replay and debug. Revisit only if rules start needing state context.

## References

- **Next steps / pick-up sheet**: [`NEXT_STEPS.md`](NEXT_STEPS.md)
- **Plan** (full architecture, MVP, deferred): [`docs/PLAN.md`](docs/PLAN.md)
- **Sample fixtures** in this package's root: [`ddhq_response_example.json`](ddhq_response_example.json), [`chameleon_response_example.json`](chameleon_response_example.json)
- **Reconciler rules** with severity table and lag math: [`src/reconcile/reconcile.ts`](src/reconcile/reconcile.ts)
- **Template spec types**: [`src/templates/types.ts`](src/templates/types.ts)
- **Template spec worked example**: [`src/templates/tickerV1.ts`](src/templates/tickerV1.ts)
- **Race-key composition (shared invariant)**: [`src/sources/common.ts`](src/sources/common.ts)
