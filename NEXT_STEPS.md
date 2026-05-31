# Next steps

A pick-up sheet for the next session. For full context see [`CLAUDE.md`](CLAUDE.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Where we left off

Foundation + replay harness + template specs + **vision slice (two-pass, measured)** in and green: **83 tests passing, typecheck clean.**

Done:
- Project skeleton (`package.json`, strict `tsconfig.json`, `.gitignore`)
- `src/store/store.ts` (in-memory ring buffer per source, retention trim, `onRecord` hook)
- `src/reconcile/reconcile.ts` + `thresholds.ts` (pure rules; name/vote/pct_in/call/vote-drop/cross-surface/air-ahead)
- `src/sources/common.ts` — shared `composeRaceKey` + `partyLetter`
- `src/sources/provider/` (DDHQ) + `src/sources/vendor/` (Chameleon) — zod schema + adapter, validated against real samples
- **Source discriminant** `DDHQ` / `Ross` / `air` (renamed from provider/vendor). `Owner`/`DataPath` role types intentionally still say provider/vendor.
- `src/replay/recorder.ts` + `player.ts` — SQLite append log + content-addressed frame PNGs
- `src/vision/llmClient.ts` — `LlmClient` (now carries `image`/`tool`/`toolChoice`), `hashPrompt`, stub + recording decorators
- `src/templates/` — `types.ts`, `geometry.ts` (`scaleRectToFrame`, normalized fractions), `registry.ts`, four real specs (`fullscreenResults`, `sideSlab`, `lowerThird`, `tickerV1`), all region-verified
- **`src/vision/extractFrame.ts`** — the two-pass extractor (see below). `anthropicClient.ts` (real Messages API), `goldenClient.ts`, `cropRegion.ts`, `redact.ts`
- **`src/runtime/composition.ts` + `liveMain.ts` + `replayMain.ts`**
- Tools: `calibrate`, `probe`, `capture-golden`, `verify`, `measure-call` (all `npm run …`)
- First golden: `recordings/goldens/ticker_tx_senate.*` + a hermetic replay test (no API key)
- `sharp` + `@anthropic-ai/sdk` installed

Reference frames in `recordings/reference-frames/` (git-tracked): `fs-2…5`, `slab-2/3`, `l3-2/3`, `ticker.png` (4K), `ticker_1280/1920.png`. Sample JSONs in repo root: `ddhq_response_example.json`, `chameleon_response_example.json`.

## How vision works now (the big shape — supersedes parts of docs/PLAN.md)

- **Plain Messages API + `ANTHROPIC_API_KEY`** (live only; replay/golden need no key), NOT the Agent SDK / Claude Code.
- **Two passes** in `extractFrame`:
  1. Haiku 4.5, full frame + registry menu (forced tool) → array of present templates with `singletons` + `candidates`.
  2. Sonnet 4.6 on an upscaled `captureRegion` crop → overrides `calledFor` only (the ✓ glyph is too small to read reliably on the full frame).
- **Measured reliability** (vs. golden ground truth, via `verify`/`measure-call`): bulk fields 30/30; `calledFor` ~37% (full-frame Haiku) → **20/20** (Sonnet recall on crop). Don't trust count-only checks — measure field-by-field.
- **Resolution floor:** keep frames ≥1920-wide (ticker mush at 1280). API ~1.15MP auto-shrink tested fine.
- **The precision re-crop the plan deferred is now BUILT and used** (for calls). `captureRegion` (normalized fractions) earns its keep here.

## Next move (highest leverage) — all blocked on user inputs

The vision pipeline is done and proven. Remaining work is real-data plumbing; adapters are ready and tested, they need connection details:

- **Provider poller** (`src/sources/provider/poller.ts`) — DDHQ on a tick → adapter → store. **Needs endpoint URL + auth.**
- **Vendor poller** (`src/sources/vendor/poller.ts`) — **needs decision: direct Chameleon DB, or HTTP returning the JSON shape we parse?**
- **Air capturer** (`src/sources/air/capturer.ts`) — screenshot the DirecTV window → frame buffer → `extractFrame`. **Needs decision on screenshot mechanism** (MCP tool vs `screencapture -l <windowId>` on macOS).
- **Wire pollers + capturer into `liveMain`.**
- **Fastify web view** at `localhost:8787` — state per source, recent alerts, last frame.
- **First real golden** from a captured broadcast segment.

Optional, unblocked: capture goldens for the other 5 reference frames (fullscreen/slab/lower-third) now that they're re-verified through the two-pass path.

## Blocked on user input

- **DDHQ endpoint URL + auth scheme.**
- **Chameleon access pattern** (direct DB vs HTTP JSON).
- **DirecTV-window screenshot mechanism.**
- **Sample data variants** to widen schemas before going live: one Presidential, one Primary, one statewide General (partial ✔), one Special. Drop in repo root + extend schema-parse tests.

## Open design decisions, deferred

Tracked in [`CLAUDE.md`](CLAUDE.md) "Known gaps / deferred work":
- Presidential `ecvotes` not modeled
- County-level reconciliation
- Magic wall (v1.1: locatable detection + `provider_direct`)
- `judge()` LLM call (rules-only for now)
- Air→canonical raceKey: air composes the full `composeRaceKey` from on-screen parts + session constants (year + contest type known up front, not read from pixels)

## Useful commands

```bash
npm test                                              # 83 tests, hermetic (no API key)
npm run typecheck
npm run calibrate -- <templateId> <framePng>          # crop a region to verify it
npm run probe -- <framePng>                           # one live extractFrame, prints observations (needs key via .env)
npm run capture-golden -- <framePng> <name>           # freeze a golden (live)
npm run verify -- <goldenName> [runs]                 # N live runs vs golden, field-by-field pass count
npm run measure-call -- <framePng> <expected> [runs]  # call-detection reliability (--model / --recall-model / --votes)
node --import tsx src/runtime/replayMain.ts <sessionId>
```

API key lives in gitignored `.env` (`ANTHROPIC_API_KEY=…`); all `probe`/`capture`/`verify` scripts load it automatically.
