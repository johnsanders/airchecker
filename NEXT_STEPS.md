# Next steps

A pick-up sheet for the next session. For full context see [`CLAUDE.md`](CLAUDE.md) and [`docs/PLAN.md`](docs/PLAN.md).

## Where we left off

The full live pipeline runs end-to-end **and has been proven against real broadcasts**: **all three sources → identity resolver → store → reconciler → web view**. **170 tests passing, typecheck clean.**

Done (foundation → live system):
- **Store / reconciler** — `src/store/store.ts` (per-source ring buffer, retention trim, `onRecord` hook, `rekeySourceRace`); `src/reconcile/reconcile.ts` + `thresholds.ts` (pure rules; name / vote / pct_in / call / vote-drop / cross-surface / air-ahead).
- **Sources, all wired and live-verified:**
  - **DDHQ provider** (`src/sources/provider/`) — OAuth + paginated poller, zod schema, adapter, runtime query list.
  - **Chameleon vendor** (`src/sources/vendor/`) — poller (hardcoded playlist URL, VPN-only), zod schema, adapter.
  - **Air** (`src/sources/air/`) — browser/CDP-attach capturer (`browserCapturer.ts`, puppeteer-core over `localhost:9222`, DRM stream verified non-black), `captureScheduler.ts` (interval/manual, runtime-reconfigurable), `matchStore.ts` (which tab to capture).
- **Vision** (`src/vision/`) — two-pass `extractFrame` (Haiku 4.5 bulk + Sonnet 4.6 call-recrop), `anthropicClient`, `goldenClient`, `cropRegion`, `redact`, recording/stub `llmClient`.
- **Templates** (`src/templates/`) — `types`, `geometry`, `registry`, four region-verified specs (`fullscreenResults`, `sideSlab`, `lowerThird`, `tickerV1`).
- **Identity resolver** (`src/identity/raceIdentity.ts`) — the cross-source race-linking layer (see below), **now exercised live end-to-end**.
- **Replay harness** — `src/replay/recorder.ts` + `player.ts` (SQLite append log + content-addressed PNGs + identity-event log; `readIdentityEvents` returns `{ event, ts }[]`, `lookupLlm` replays a recorded response by hash). **Two golden kinds** (see below): frame goldens under `recordings/goldens/` and **session goldens** under `recordings/goldens/sessions/`.
- **Settings** (`src/settings/settingsStore.ts`) — persistent `recordings/settings.sqlite` (DDHQ query list + identity snapshot survive restarts).
- **Web view** (`src/web/`) — Fastify JSON API + **websocket push** (`server.ts`, `changeBus.ts`) + Vite/React/MUI SPA. Components: `SourceHealth`, `RaceTable`, `RaceDetail` (+ `RaceDetailDialog`), `Alerts`, `CapturePanel`, `QueryEditor`, `RaceLinks`.
- **Runtime** — `composition.ts` + `liveMain.ts` (live, recorder always on) + `replayMain.ts`; anomaly emission/hysteresis in `anomalyTracker.ts` (the alert layer — no separate `alerts/` dir).

### What the June broadcast sessions demonstrated (the linking feature, live)

The riskiest fresh code — cross-source linking against all three real sources at once — **shook out clean over two broadcast nights** (recordings gitignored; identity state persisted in `settings.sqlite`):

- **TX runoffs, June 1** — a 16:09 session registered **57 Ross races as provisional canonicals** (all events recorded); the 16:17 / 16:40 / 17:44 sessions ran **all three sources simultaneously** (DDHQ + Ross + air with frames). Haiku link proposals fired live (7, then 21, then 3 proposal events); **a human accepted 10** via the web `RaceLinks` panel; **none pending now**. Current `settings.sqlite` identity state: aliases = 6 deterministic + 10 proposal + 57 provisional + 6 provider; 78 canonicals (72 provisional — Ross races with no DDHQ canonical, expected given the DDHQ query list).
- **Primary night, June 2** — CA/IA/NJ/AL/LA races, **DDHQ + Ross only** (no air capture). The big one is `recordings/live-2026-06-02T15-45-45-019Z-d1626ace.sqlite`: **117,277 observations over ~hours** — the real-scale noise audit target below.

## How race linking works now

`src/identity/raceIdentity.ts` sits between the adapters and the store so the three sources land in **one canonical bucket per political race**, even when their raw keys don't match exactly.

- **DDHQ is the canonical spine** — its `raceKey` registers the canonical race.
- Each non-DDHQ observation resolves via: existing alias → deterministic normalized match against a **settled** canonical (auto-linked) → otherwise a **provisional** bucket plus a **one-time Haiku reconcile** that *proposes* a link for a human to accept/reject. **LLM links are never auto-applied.**
- **Provisional races re-attempt on every later sighting**, so a source seen *before* its DDHQ canonical still links once that canonical lands (deterministic path or the one-time proposal). The Haiku call fires at most once per source race; `upsertAlias`/`ensureCanonical` skip emit+persist when unchanged.
- Aliases / canonicals / proposals persist in `settings.sqlite`; identity events + the Haiku call are **recorded**, so replay reconstructs links with **no API key**.
- The web `RaceLinks` panel + `/api/race-links/*` let a human **accept/reject proposals and re-link any source race at any time**; the store re-keys retained observations into the new bucket.

## How session goldens work (the real-broadcast regression backbone)

A **frame golden** freezes one image + its recorded two-pass LLM responses (vision regression). A **session golden** freezes what the store + reconciler emit over a whole recorded timeline (pipeline regression built from real data).

- `src/replay/sessionGolden.ts` → `replaySessionTimeline` replays a session's observations **in their original poll batches** (grouped by `observedAt`), applies the recorded identity events as **mid-timeline rekeys**, reconciles at each batch's own timestamp, and returns frozen `SessionExpectations`: the **distinct-anomaly set** ("everything that would have alerted"), the **final standing anomalies**, an **identity summary** (aliases by method, canonical/provisional counts, proposals by status), and **store stats**.
- **Freeze:** `npm run freeze-session -- <sessionId> <goldenName>` reads the session sqlite and writes `recordings/goldens/sessions/<name>.session.json` — self-contained (~2.5MB compact JSON: inputs + expectations), so the **session sqlites stay gitignored**.
- **Refreeze:** `npm run freeze-session -- --refreeze <goldenFile>` recomputes expectations from the doc's **own frozen inputs**. Run this **only after an intentional rule/threshold change** that legitimately moves the anomaly set — review the diff first, then commit the new expectations.
- `tests/replay/sessionGoldens.test.ts` iterates every `recordings/goldens/sessions/*.session.json` **hermetically (no API key)**.
- **First session golden:** `tx_runoffs_2026-06-01_all_sources` from `live-2026-06-01T16-40-33-549Z-7ad55b7e` — 64 min, **4,147 observations → 180 poll batches, 45 identity events, all three sources**, freezing **14 distinct anomalies**.
- **Vision goldens from sessions:** `capture-golden -- --from-session <sessionId> <frameHash> <goldenName>` freezes a frame golden from a recorded session's frames + recorded LLM responses (**zero API cost, no key**). Two real June-1 broadcast frames are now promoted into `recordings/goldens/` (`live_ticker_tx_ag_r`, `live_lower_third_tx9_house` — the only template families that aired in that session) alongside the synthetic-frame goldens.

## Findings from the first session golden (14 alerts in 64 min)

1. **Surname-only air reads — RESOLVED: no template shows surnames only.** The single such read (`"MEALER"`, `"CAIN"`) came from the DD26 ticker's **stacked two-line name layout** ("R ALEX / ✓MEALER" — first names fully visible on screen; see frame `9a5b30e8…` in the June-1 session): a VLM line-miss, not a graphic convention. Already **fixed upstream 21 minutes after that read was recorded** — `d12428c` ("Drop partial-name air reads as missed captures") drops any air race whose candidates aren't all full "First Last" names as a missed capture, so partial reads no longer reach the store. The golden replays the pre-guard recorded observation, so its `name_mismatch` + `call_mismatch` + duplicate `votes_mismatch` fan-out stays frozen as a faithful "what the reconciler does with a partial read" — do **not** refreeze it away, and no reconciler surname-fallback is needed. Residual policy: each VLM fumble now costs one dropped capture (~one cadence interval); only if drops get frequent, add a `tickerV1` prompt hint that ticker names stack on two lines.
2. The other 11 alerts were **stale-air votes / pct_in mismatches**, plausible for that session (captured graphics replayed against a vendor DB that already held final numbers). Thresholds behaved sanely — no tuning needed.

## Primary-night noise audit — done 2026-07-19

Replayed `live-2026-06-02T15-45-45-019Z-d1626ace` through `replaySessionTimeline`: **49.75 h of monitoring** (the recorder ran through June 4), 117,277 observations → 3,801 poll batches, **9.9 s replay wall time** — scale is a non-issue; only the ~50MB doc size keeps this session out of the committed goldens.

- **9 distinct alerts in ~50 h — all real, zero false noise.** All medium `vote_drop`, all Ross, all IA primaries (Governor R ×5, US Senate D ×2, US Senate R ×2), all in one window (~01:52–01:55 UTC June 3, election night). Vote curves confirm a genuine vendor over-count + correction: IA-Sen-D Turek jumped 45,045 → 83,628 **in one poll while pct_in FELL** (17.02 → 16.83), peaked at 88,185, snapped back to 51,290, then resumed a normal climb. Thresholds behaved; no tuning needed.
- **Finding: standing alerts are transient.** All 9 cleared on the next clean poll (~1 min later) — final standing count was 0. An operator watching the web view could miss the entire event. The deferred alert-history/log sink now has a concrete justification (next move #2).
- **Finding: the reconciler flagged the *correction*, not the *inflation*.** The bad (inflated) numbers were live for ~3 polls before the drop fired. A "votes rose while pct_in fell" internal-consistency rule would catch it at onset — next move #3, user's call.

## Next moves (priority order)

1. **Recorder bloat fix before a real 6-hour broadcast.** The recorder stores each LLM request verbatim **including the base64 frame** in `llm_calls.request` → **~240MB/hour** sessions. Store the request **minus the image payload** (the frame is already content-addressed in `frames/`).
2. **Alert history / log sink.** Standing alerts clear on the next clean poll (see audit above), so one-poll events vanish from the web view in ~a minute. Persist an append-only alert event log (structured log sink + a recent-events panel) so they survive operator blinks.
3. **Candidate rule — votes up while pct_in down (user decision).** Catches upstream inflation at onset instead of at correction; on primary night it would have fired at 01:52 instead of 01:54. If added: review + `--refreeze` the session golden.
4. **Carried over, still open:** `judge()` LLM downgrade call (rules-only for now); Slack / paging sinks; auth on the web view; multi-race concurrent monitoring config; sample-data variants (one Presidential, one Primary, one Special) to widen schema-parse tests before those race types go live.
5. **Housekeeping (user's call).** ~20 near-empty May-31 shakeout session DBs + stray `-wal`/`-shm` files in `recordings/` can be deleted; all gitignored.

## Useful commands

```bash
npm test                                              # 170 tests, hermetic (no API key)
npm run typecheck
npm run live                                          # full live system + web view (needs .env + VPN)
npm run chrome:debug                                  # launch the DirecTV Chrome the air capturer attaches to (CDP :9222)
npm run web:build                                     # build the React SPA (src/web/client/dist)
npm run freeze-session -- <sessionId> <goldenName>    # freeze a session golden → recordings/goldens/sessions/<name>.session.json
npm run freeze-session -- --refreeze <goldenFile>     # recompute expectations after an intentional rule change (review diff first)
npm run capture-golden -- <framePng> <name>           # freeze a frame golden (live, needs key)
npm run capture-golden -- --from-session <sessionId> <frameHash> <name>   # freeze a frame golden from recorded frames (no key)
npm run calibrate -- <templateId> <framePng>          # crop a region to verify it
npm run probe -- <framePng>                           # one live extractFrame, prints observations (needs key via .env)
npm run air:probe                                     # capture one live air frame and extract it (needs Chrome + key)
npm run verify -- <goldenName> [runs]                 # N live runs vs golden, field-by-field pass count
npm run measure-call -- <framePng> <expected> [runs]  # call-detection reliability (--model / --recall-model / --votes)
node --import tsx src/runtime/replayMain.ts <sessionId>
```

API key lives in gitignored `.env` (`ANTHROPIC_API_KEY=…`); all `probe`/`capture`/`verify` scripts load it automatically. Replay, session goldens, and `--from-session` need **no key**.
