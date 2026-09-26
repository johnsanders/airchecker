# Next steps

A pick-up sheet for the next session. Full context: [`CLAUDE.md`](CLAUDE.md), the finish-line plan [`docs/PLAN_V2.md`](docs/PLAN_V2.md) (what was done, why, and what was measured), and the reference-frame index [`recordings/reference-frames/README.md`](recordings/reference-frames/README.md).

## Where we left off (2026-09-25)

The system is retargeted to the **September 2026 graphics package** and proven against it offline. **237 tests, typecheck and lint clean.** Working directory is `~/Developer/airchecker` (`.env`, `recordings/settings.sqlite`, and the June session recordings live here; `~/Developer/nn-airchecker-old` holds only leftovers and can be deleted).

Done since the July hand-off, in order:

- **Graphics refresh** — ticker, lower-third and fullscreen specs rewritten against 23 reference frames cut from the graphics team's `air_example.mp4` (gitignored under `recordings/video/`); side slab retired; every race is two candidates; `>N% IN` is a floor; race keys drop the heading divider. The extractor changed shape in five measured ways (pass 1 owns names, crop reads per region with label self-correction, the crop read reads the heading and the name as two lines, crops sized to the API tier, placeholder/junk guards) — see `docs/PLAN_V2.md` Phase 1 for each with its evidence.
- **Reliability** — check-mark detection 20/20 called and 20/20 uncalled on all three surfaces; nine goldens reproduce 10/10 over live re-runs; 23 frame goldens replay hermetically.
- **Rules** — `field_missing` (a required on-air field absent, e.g. the `% IN` badge — always supposed to be there) and `multiple_winners` (`thresholds.maxWinners = 1` for the Nov 3 general).
- **Hysteresis** in `anomalyTracker` with trigger-aware sighting counts and a recovery hold; **`airHysteresisN = 1`** by decision — a single bad graphic alerts when seen.
- **Alert history** — every raise/clear is an `AlertEvent`: `GET /api/alert-history`, the "Recent alert events" panel, the recorder's `alert_events` table, and a `[alert] {json}` log line.
- **Video dry run** — `npm run import-video -- <mp4> [fps]` runs the whole air pipeline over a recording; `recordings/goldens/sessions/air_example_video_0p2fps.session.json` freezes the result (air-only timeline; raises exactly the two-✓ SC ticker and the three badge-less fullscreens).

## Next moves (priority order)

1. **Rehearsal session with all three sources** against the new package (needs the VPN for Chameleon and DDHQ queries for the Nov 3 races). Promote 1–2 real frames with `capture-golden -- --from-session`, freeze a second full session golden, and confirm the identity resolver links the new air headings (proposal-driven; a human accepts in the `RaceLinks` panel).
2. ~~Rule: votes up while pct_in down~~ — **dropped**: on statewide/high-profile races `% IN` is a share of estimated turnout and legitimately falls when the estimate is revised up mid-count. Only revisit gated on DDHQ `reporting_type` (precinct-based races).
3. ~~Fixtures~~ — done 2026-09-26 (`*_general_example.json` in the repo root, see below).
4. **Deterministic Ross→DDHQ linking.** Every Nov 3 Chameleon contest carries `raceID` = the DDHQ `race_id`. Reading it in the adapter and letting the identity resolver alias on it would remove the Haiku proposal + human accept step for vendor races entirely (air races still need it). Small change; decide before the rehearsal.
5. **Web-view auth** (`WEB_TOKEN`) only if the view leaves localhost.
6. Deferred, unchanged: magic wall (`provider_direct` path), `judge()`, Slack/paging sinks, EC votes, county-level.

**Source check 2026-09-26 (DDHQ + Chameleon, live).** Both reachable and authenticating, and both broke the zod boundary on today's data — fixed and covered by tests: DDHQ `precincts.percent` is `null` pre-election (→ `pctIn` 0); DDHQ `next_page_url` is schemeless on another host, so pagination had never actually worked (only single-page `race_ids=` queries were ever used) — the poller now re-bases it onto `DDHQ_BASE_URL`; Chameleon's `area.State`/`District`/`County` are mostly absent on the General playlist (lowercase built-ins carry the data). After the fixes: a 38-race, 4-page Nov 3 query drains cleanly; the playlist has 135 contests, 119 of them for Nov 3 across 47 states (Senate, House, Governor, two specials, two ballot questions), and **119/119 Nov 3 contests key identically to the DDHQ races their `raceID` names**. DDHQ's Nov 3 races are flagged `test_data: true` today. The persisted DDHQ query list is still the June runoff `race_ids=` entry — replace it in the web view before the rehearsal. **`% IN` is `turnout_mid`:** per DDHQ's docs the DDHQ adapter now follows `reporting_type` (`estimated` → `estimated_votes.turnout_mid`, `precincts` → `precincts.percent`; everything in scope is `estimated`) and the Chameleon adapter reads `dbVotesPercent` (its copy of `turnout_mid`, the field the template renders) instead of the precinct-based `polls.reportedPercent`. The three `pct_in_mismatch` alerts in the June session golden were this field mismatch, not a graphics fault (the golden's frozen observations predate the change, so it still replays as recorded).

Done 2026-09-26 while waiting on better frames: replay audit of the June recordings under the new rules (no new noise); `npm run replay -- <id> --serve` plays a recorded session behind the real web view; `npm run sessions` lists recordings and `-- --prune-frames <id>` drops a session's PNGs; `docs/RUNBOOK.md` is the one-page operator sheet; lint is fully clean (built bundles ignored, the five warnings fixed).

## Useful commands

```bash
npm test                                              # 237 tests, hermetic (no API key)
npm run typecheck && npm run lint
npm run live                                          # full live system + web view (needs .env + VPN)
npm run chrome:debug                                  # the DirecTV/Actus Chrome the air capturer attaches to (CDP :9222)
npm run web:build                                     # build the React SPA
npm run replay -- <sessionId> [--serve] [--speed=N]    # replay a session; --serve plays it behind the web view
npm run sessions [-- --prune-frames <sessionId>]       # list recordings / drop a session's frame PNGs
npm run import-video -- <mp4> [fps]                   # dry-run the air pipeline over a recording → a session (needs key)
npm run freeze-session -- <sessionId> <goldenName>    # session golden → recordings/goldens/sessions/
npm run freeze-session -- --refreeze <goldenFile>     # recompute expectations after an intentional rule change (review the diff)
npm run capture-golden -- <framePng> <name>           # frame golden (live, needs key); reference frames are referenced in place
npm run capture-golden -- --from-session <sessionId> <frameHash> <name>   # frame golden from a recorded session (no key)
npm run capture-golden -- --refreeze <golden.json>... # recompute a frame golden's observations from its recorded responses (no key)
npm run probe -- <framePng>                           # one live extractFrame; prints observations, ">N" floors, MISSING fields
npm run measure-call -- <framePng> <expected> [runs] [--template <id>]   # check-mark reliability
npm run verify -- <goldenName> [runs]                 # N live runs vs a golden, field-by-field
npm run calibrate -- <templateId> <framePng>          # crop a captureRegion to eyeball it
```

API key lives in gitignored `.env` (`ANTHROPIC_API_KEY=…`); replay, goldens, and `--refreeze` need **no key**.
