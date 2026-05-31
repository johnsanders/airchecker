# Eagle Eye — Election Graphics Observer

> **Amendments (this doc is the original plan; these decisions supersede parts of it).** See [`CLAUDE.md`](../CLAUDE.md) for current state.
> - **Vision is one-shot, not per-template.** Pixel/color fingerprints were removed; the "fingerprint prefilter → per-template `detect` → per-template `extract`" flow below is replaced by ONE Messages-API call per frame (full frame + template registry as a menu → array of templates present, each extracted). `detect` collapses into that call.
> - **Plain Messages API + `ANTHROPIC_API_KEY`**, not the Agent SDK / Claude Code (no local model; subscriptions can't auth programmatic calls). Replay + `--stub-llm` need no key.
> - **`TemplateSpec` simplified** to one loose normalized `captureRegion` + `vlmPromptHint` + `singletons` + `candidateList` (VLM returns a candidate array). No per-field rects; `Rect` is normalized `[0..1]` fractions. `captureRegion` is now only an optional precision re-crop.
> - **Sources renamed** `provider`→`DDHQ`, `vendor`→`Ross`.
> - **Resolution floor:** keep frames ≥1920-wide (ticker text is mush at 1280); the API's ~1.15MP auto-shrink is an open question for the first golden.

## Context

A TV news network's election-night graphics pipeline has three layers, deliberately offset in time: a political provider API, a third-party vendor product that ingests it into its own DB, and on-air graphics (a persistent ticker at the very bottom, a lower-third that can appear just above it, fullscreen results, and other variants — under a dozen total templates) that read from the vendor DB. There is also an **interactive "magic wall"** on a presenter-driven video wall that pulls data **directly from the political provider, bypassing the vendor entirely**. Any data layer can drift; multiple on-air surfaces can be visible simultaneously and must agree across vendor-driven and provider-direct paths.

Today there is no way to know — during a live broadcast — that what's on air matches what the provider actually published, or that two simultaneous surfaces show the same numbers, or that the display layer's formatting is sane. The user wants a system that watches all three sources, reasons about consistency over a rolling time window, and flags trouble for human review.

This is greenfield. The directory is empty. Target: an ongoing capability, not a single-election sprint — so the replayable harness is a first-class design goal, not an afterthought.

## Architecture

A single TypeScript/Node service. Three long-running loops, one shared in-memory store with an append-only log, one small HTTP surface, two entry points (`liveMain.ts`, `replayMain.ts`).

```
provider API   →  providerPoller  ─┐  (feeds vendor-driven surfaces AND, directly, magic-wall reconciliation)
vendor DB      →  vendorPoller    ─┼→  Store (per-race timelines + append log)
DirecTV window →  airCapturer     ─┤        ↓
                  ├─ detect (per template; fixed region OR locate in frame)
                  └─ extract (per detected template, optionally cropped to detected bbox)
                                            ↓
                                        Reconciler  →  AlertSink (log + Fastify web view)
                                        (3-source path for vendor-driven surfaces;
                                         2-source path for magic-wall)
```

**Layout** under `src/`:

- `sources/{provider,vendor,air}/` — pollers; `air/` uses an MCP screenshot tool against the DirecTV window.
- `vision/{detect.ts,extract.ts,judge.ts}` — the only LLM call sites.
- `templates/{types.ts,tickerV1.ts,registry.ts}` — one declarative `TemplateSpec` per template.
- `store/store.ts` — per-race ring buffer (~30 min) + SQLite append log; same log is used live and as the replay source of truth.
- `reconcile/{reconcile.ts,thresholds.ts}` — pure functions: triangulation, lag math, hysteresis, severity.
- `alerts/{sink.ts,logSink.ts,webSink.ts}` — pluggable; v1 is structured log + web view.
- `web/server.ts` — Fastify; shows live state per source, recent alerts, last captured frame with extracted fields overlaid.
- `replay/{recorder.ts,player.ts,importVideo.ts,importProvider.ts,importVendor.ts}` — record always, replay deterministically.
- `runtime/` — composition root; wires the same modules in either live or replay mode.

Functional style throughout: factory arrow functions returning record-of-functions handles, no classes, no DI framework, no event bus. Dependencies kept minimal: `fastify`, `zod` (boundary validation only), `pino`, `better-sqlite3`, `pg` (or the vendor's driver), `@anthropic-ai/sdk`, `vitest`, `tsx`.

## TemplateSpec — the central data shape

Specs are declarative TS. Vision functions read them; reconciler reads them. Each spec owns its own `captureRegion`, so multiple specs can match the same frame simultaneously (fullscreen + ticker).

```ts
// src/templates/types.ts
export type Rect = { x: number; y: number; w: number; h: number };

export type FieldFormat =
	| { kind: 'integer' }
	| { kind: 'percent'; min: 0; max: 100; decimals: 0 | 1 }
	| { kind: 'enum'; values: readonly string[] }
	| { kind: 'candidateName' }
	| { kind: 'partyLabel' };

export type FieldSpec = {
	name: string;
	region: Rect; // pixel-space within captureRegion
	format: FieldFormat;
	required: boolean;
};

export type FingerprintHint =
	| { kind: 'colorBand'; region: Rect; expectHex: string; tolerance: number }
	| { kind: 'textMatch'; region: Rect; expectPattern: string };

export type TemplateSpec = {
	id: string;
	displayName: string;
	surface: 'ticker' | 'lower_third' | 'fullscreen' | 'corner_bug' | 'magic_wall';
	dataPath: 'vendor' | 'provider_direct'; // determines 3-source vs 2-source reconciliation
	// Fixed region for stationary templates; absent for locatable ones (magic wall).
	// When absent, detect() returns a bbox the extractor uses.
	captureRegion?: Rect;
	fingerprint: { hints: FingerprintHint[]; vlmPromptHint: string };
	fields: FieldSpec[]; // for locatable templates, field regions are relative to detected bbox
	bind: {
		raceKeyFrom: (extracted: Record<string, string>) => string;
		candidateKeyFrom: (extracted: Record<string, string>, fieldIndex: number) => string;
	};
};
```

`src/templates/tickerV1.ts` is the first concrete spec (race label, state, two candidate rows with party/name/votes/pct, pct_in, called_for). It doubles as the worked example for future templates. Rects calibrated once via a small `npm run calibrate <templateId> <framePng>` helper that draws the rects over the frame in the browser for visual verification.

## Detection & extraction (per template, not per frame)

For each captured frame, iterate over registered templates:

1. **Fingerprint hint check** (deterministic, no LLM) — color band match + text region match against the template's `captureRegion`. If hints reject, skip this template for this frame.
2. **`detect(framePng, templateSpec)`** (Haiku 4.5) — confirms template presence in its region. Returns `{ present: boolean, confidence }`. Skipped if hints already confidently rejected; runs as belt-and-suspenders when hints pass.
3. **`extract(framePng, templateSpec)`** (Haiku 4.5, escalate to Sonnet 4.6 if validators fail) — returns `Record<fieldName, string>` plus per-field confidence. Format validators run after: integer parse, percent range, enum membership, candidate-name fuzzy-match against the provider roster.

Multiple templates can match the same frame (commonly the ticker plus a lower-third for a featured race, occasionally plus a fullscreen takeover, sometimes the magic wall as a backdrop behind a presenter); each produces its own `RaceObservation`. "No templates matched AND ticker fingerprint band absent for > 20s" flips an `inBreak` flag that suppresses "ticker missing" alerts until the band returns.

**Locatable templates (magic wall).** When `captureRegion` is absent, `detect` is asked to find the surface anywhere in the frame and return `{ present, bbox, confidence }`. Fingerprint hints are skipped or weakened (no fixed coords to check). Extraction then operates on the bbox-cropped image, with field rects interpreted relative to the bbox. The magic wall is dynamic — the presenter changes what's displayed — so extraction also reads "what race/jurisdiction is currently shown" as a field, and reconciliation looks up _that_ race in the provider, not a preconfigured one.

## Temporal reconciliation

Per-race rolling timeline of `RaceObservation`s from all three sources (~30 min ring buffer). Reconciler is pure functions over the three buffers.

- **Lag model**, configured per pair: `providerToVendorLagMs` default 90s (max 180), `vendorToAirLagMs` default 8s (max 30). To evaluate "air at T", compare against vendor at `T − vendorToAirLagMs ± slack` and provider at `T − totalLag ± slack`. Air _ahead of_ upstream is itself an anomaly.
- **Field tolerances**: candidate name exact after normalization; vote totals must equal something seen in the upstream lag window; pct_in ±1; `called_for` must match within window — a premature on-air call is the highest-severity path.
- **Monotonicity is soft.** Flag a vote drop only if `>5%` AND `>500` absolute AND not corroborated upstream within the lag window. Thresholds live in `reconcile/thresholds.ts`.
- **Cross-surface consistency.** When two or more surfaces are detected on the same frame (ticker, lower_third, fullscreen), compare every pair that shares a race — same numbers, same formatting (decimals, thousands separators, leader indicator). Mismatch is a display-layer anomaly even if all three agree with the data sources.
- **Triangulation routes ownership.** A small table maps `(provider, vendor, air)` agreement patterns to verdict + severity + owner: provider=vendor≠air → render bug (us); provider≠vendor=air → vendor ingestion bug; provider≠vendor, vendor=expected-from-history → vendor DB outlier; etc. Magic-wall observations use a two-source path (provider + air only), and act as an **independent witness**: when the magic wall and a vendor-driven surface show the same race, agreement of magic-wall with provider against a disagreeing vendor surface promotes a vendor ingestion bug from MEDIUM to HIGH confidence.
- **Hysteresis.** No alert until anomaly persists N consecutive observations (N=3 for air, N=2 for vendor). Recovery requires M clean observations to clear.

Explicit non-goal for v1: a per-race state machine (uncalled → leading → called → recount). A flat observation list + pure reconcile functions is easier to replay and debug. Add the state machine only if reconcile rules start needing state context.

## LLM boundary (surgical)

Three call sites, all with prompt caching enabled on the stable portions:

1. **`detect`** — Haiku 4.5, per template per frame (after fingerprint hints filter). ~12k–30k frames per 6-hour broadcast; budgeted cost ~$25/night.
2. **`extract`** — Haiku 4.5 with Sonnet 4.6 escalation on validator failure. Template spec is the cached portion.
3. **`judge(anomalyContext)`** — Sonnet 4.6, _only_ when deterministic rules have already decided an anomaly is real. Can downgrade or annotate, never raise severity. Deferred until v1.1 — rules-only is enough to start.

Opus 4.7: not used. Flag it only if a post-broadcast "explain what went wrong" summarizer becomes a requirement.

## Replay harness (test backbone)

One wire format, two modes.

- **Recorder** (always on in live mode): every observation, every frame PNG, every LLM request/response gets appended to `recordings/<sessionId>.sqlite` with monotonic `seq` and wall-clock `ts`. Frames are content-addressed PNGs alongside.
- **Player**: `replayMain.ts <sessionId> [--speed=N] [--stub-llm|--live-llm]`. Same composition root, swaps the three source modules for replay sources that emit recorded events in original relative order. `--stub-llm` reuses recorded LLM responses keyed by `(frame hash, prompt hash)` — fully deterministic, zero API cost, fast. This is the test suite.
- **Capture past elections**: small `import*` scripts ingest OBS/QuickTime recordings (ffmpeg → 1Hz frames), historical provider JSON dumps, and periodic vendor DB `SELECT *` snapshots into the same SQLite schema.
- **Golden replays** under `recordings/goldens/` with labeled expected alerts. `npm run replay:goldens` is the CI suite.

## MVP scope

**In:**

- One template (`ticker_v1`), one configurable race.
- All three sources end-to-end.
- Reconciler covering: name mismatch, vote-total mismatch beyond lag window, pct_in mismatch, premature/missing call, cross-surface formatting mismatch (when a second template lands later). Hysteresis. Commercial-break suppression.
- Recorder always on; replay harness with `--stub-llm`.
- Log sink + Fastify web view at `localhost:8787`.
- One golden replay session.

**Deferred:**

- The other vendor-driven templates (each is "write a `TemplateSpec` + calibrate rects").
- **Magic wall** — design accommodates it via `captureRegion?` + `dataPath: 'provider_direct'`, but locatable detection and dynamic-jurisdiction extraction are v1.1 work. The user's library of magic-wall recordings becomes prime golden-replay material when this lands.
- Multi-race concurrent monitoring (architecture supports it; MVP configures one).
- `judge()` Sonnet call.
- Slack / dashboard / paging sinks.
- Auth on the web view.

## Critical files to create

- `src/templates/types.ts` — `TemplateSpec` and friends. Everything depends on this shape.
- `src/templates/tickerV1.ts` — first concrete spec; the worked example.
- `src/reconcile/reconcile.ts` — pure triangulation and severity. Most-tested file in the project.
- `src/store/store.ts` — ring buffer + append log; the seam between live and replay.
- `src/replay/player.ts` — replay entry point; makes the test suite possible.

Build order: types → store → reconciler (with unit tests) → providerPoller (easiest source) → recorder → replay player with stub sources → vision functions → wire `liveMain` → web view → capture first golden.

## Verification

- **Unit tests** (Vitest): every row of the triangulation severity table; lag math via property tests; name normalizer via fixture table.
- **Replay-as-tests**: `npm run replay:goldens` runs each golden session in `--stub-llm` mode and snapshot-asserts `(seq, alertType, severity, raceKey)`. Adding a new golden = capture a session, label expected alerts, commit. This is the load-bearing check.
- **Live dry-run**: `npm run live -- --race=<key> --no-alerts` pointed at the vendor's current contents during a non-election day; visually confirm the web view shows expected state.
- **Calibration helper**: `npm run calibrate <templateId> <framePng>` opens the frame with spec rects drawn over it for sanity-checking before running anything else.
- **Prompt iteration**: re-run a golden with `--live-llm` after a prompt change; diff alerts vs the stub run.
