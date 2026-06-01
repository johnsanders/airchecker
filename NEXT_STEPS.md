# Next steps

A pick-up sheet for the next session. For full context see [`CLAUDE.md`](CLAUDE.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Where we left off

The full live pipeline runs end-to-end: **all three sources → identity resolver → store → reconciler → web view**. **146 tests passing, typecheck clean.**

Done (foundation → live system):
- **Store / reconciler** — `src/store/store.ts` (per-source ring buffer, retention trim, `onRecord` hook, `rekeySourceRace`); `src/reconcile/reconcile.ts` + `thresholds.ts` (pure rules; name / vote / pct_in / call / vote-drop / cross-surface / air-ahead).
- **Sources, all wired and live-verified:**
  - **DDHQ provider** (`src/sources/provider/`) — OAuth + paginated poller, zod schema, adapter, runtime query list.
  - **Chameleon vendor** (`src/sources/vendor/`) — poller (hardcoded playlist URL, VPN-only), zod schema, adapter.
  - **Air** (`src/sources/air/`) — browser/CDP-attach capturer (`browserCapturer.ts`, DRM stream verified non-black), `captureScheduler.ts` (interval/manual, runtime-reconfigurable), `matchStore.ts` (which tab to capture).
- **Vision** (`src/vision/`) — two-pass `extractFrame` (Haiku 4.5 bulk + Sonnet 4.6 call-recrop), `anthropicClient`, `goldenClient`, `cropRegion`, `redact`, recording/stub `llmClient`.
- **Templates** (`src/templates/`) — `types`, `geometry`, `registry`, four region-verified specs (`fullscreenResults`, `sideSlab`, `lowerThird`, `tickerV1`).
- **Identity resolver** (`src/identity/raceIdentity.ts`) — the cross-source race-linking layer (see below).
- **Replay harness** — `src/replay/recorder.ts` + `player.ts` (SQLite append log + content-addressed PNGs + identity-event log). Goldens under `recordings/goldens/`: `ticker_tx_senate`, `fs_ga11_house_3way`, `fs_ga11_house_5way`, `multi_ga11_fs_plus_tx_ticker`.
- **Settings** (`src/settings/settingsStore.ts`) — persistent `recordings/settings.sqlite` (DDHQ query list + identity snapshot survive restarts).
- **Web view** (`src/web/`) — Fastify JSON API + Vite/React/MUI SPA. Components: `SourceHealth`, `RaceList`, `RaceDetail`, `Alerts`, `CapturePanel`, `QueryEditor`, `RaceLinks`.
- **Runtime** — `composition.ts` + `liveMain.ts` (live, recorder always on) + `replayMain.ts`.

## How race linking works now (newest layer)

`src/identity/raceIdentity.ts` sits between the adapters and the store so the three sources land in **one canonical bucket per political race**, even when their raw keys don't match exactly.

- **DDHQ is the canonical spine** — its `raceKey` registers the canonical race.
- Each non-DDHQ observation resolves via: existing alias → deterministic normalized match against a **settled** canonical (auto-linked) → otherwise a **provisional** bucket plus a **one-time Haiku reconcile** that *proposes* a link for a human to accept/reject. **LLM links are never auto-applied.**
- **Provisional races re-attempt on every later sighting**, so a source seen *before* its DDHQ canonical still links once that canonical lands (deterministic path or the one-time proposal). The Haiku call fires at most once per source race; `upsertAlias`/`ensureCanonical` skip emit+persist when unchanged.
- Aliases / canonicals / proposals persist in `settings.sqlite`; identity events + the Haiku call are **recorded**, so replay reconstructs links with **no API key**.
- The web `RaceLinks` panel + `/api/race-links/*` let a human **accept/reject proposals and re-link any source race at any time**; the store re-keys retained observations into the new bucket.

## Next move (highest leverage)

**1. Prove the linking feature live — never run against all three real sources at once.** It's tested only hermetically. Run live (needs `.env` + VPN), then watch: provisional races settle to canonical, a Haiku proposal actually appears in the `RaceLinks` panel, accept one and confirm reconciliation re-runs. This is the riskiest fresh code — shake it out before building more.

**2. First real broadcast golden.** Capture a live segment → freeze as a golden so the linking + reconciliation path has a deterministic regression test built from real data (today's goldens predate linking). Optional: goldens for the slab / lower-third families.

## Deferred / open (tracked in [`CLAUDE.md`](CLAUDE.md) "Known gaps")

- `judge()` LLM downgrade call (rules-only for now)
- Real alert sinks (Slack / dashboard / paging) — v1 is structured log + web view
- Auth on the web view
- Multi-race concurrent monitoring config (architecture supports it; runtime configures for live use)
- Presidential `ecvotes`, county-level reconciliation, magic wall (v1.1: locatable detection + `provider_direct`)
- Sample data variants to widen schemas before going live: one Presidential, one Primary, one Special. Drop in repo root + extend schema-parse tests.

## Useful commands

```bash
npm test                                              # 146 tests, hermetic (no API key)
npm run typecheck
npm run live                                          # full live system + web view (needs .env + VPN)
npm run web:build                                     # build the React SPA (src/web/client/dist)
npm run calibrate -- <templateId> <framePng>          # crop a region to verify it
npm run probe -- <framePng>                           # one live extractFrame, prints observations (needs key via .env)
npm run capture-golden -- <framePng> <name>           # freeze a golden (live)
npm run verify -- <goldenName> [runs]                 # N live runs vs golden, field-by-field pass count
npm run measure-call -- <framePng> <expected> [runs]  # call-detection reliability (--model / --recall-model / --votes)
node --import tsx src/runtime/replayMain.ts <sessionId>
```

API key lives in gitignored `.env` (`ANTHROPIC_API_KEY=…`); all `probe`/`capture`/`verify` scripts load it automatically.
</content>
</invoke>
