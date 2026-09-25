# Next steps

A pick-up sheet for the next session. Full context: [`CLAUDE.md`](CLAUDE.md), the finish-line plan [`docs/PLAN_V2.md`](docs/PLAN_V2.md) (what was done, why, and what was measured), and the reference-frame index [`recordings/reference-frames/README.md`](recordings/reference-frames/README.md).

## Where we left off (2026-09-25)

The system is retargeted to the **September 2026 graphics package** and proven against it offline. **221 tests, typecheck and lint clean.** Working directory is `~/Developer/airchecker` (`.env`, `recordings/settings.sqlite`, and the June session recordings live here; `~/Developer/nn-airchecker-old` holds only leftovers and can be deleted).

Done since the July hand-off, in order:

- **Graphics refresh** — ticker, lower-third and fullscreen specs rewritten against 23 reference frames cut from the graphics team's `air_example.mp4` (gitignored under `recordings/video/`); side slab retired; every race is two candidates; `>N% IN` is a floor; race keys drop the heading divider. The extractor changed shape in five measured ways (pass 1 owns names, crop reads per region with label self-correction, the crop read reads the heading and the name as two lines, crops sized to the API tier, placeholder/junk guards) — see `docs/PLAN_V2.md` Phase 1 for each with its evidence.
- **Reliability** — check-mark detection 20/20 called and 20/20 uncalled on all three surfaces; nine goldens reproduce 10/10 over live re-runs; 23 frame goldens replay hermetically.
- **Rules** — `field_missing` (a required on-air field absent, e.g. the `% IN` badge — always supposed to be there) and `multiple_winners` (`thresholds.maxWinners = 1` for the Nov 3 general).
- **Hysteresis** in `anomalyTracker` with trigger-aware sighting counts and a recovery hold; **`airHysteresisN = 1`** by decision — a single bad graphic alerts when seen.
- **Alert history** — every raise/clear is an `AlertEvent`: `GET /api/alert-history`, the "Recent alert events" panel, the recorder's `alert_events` table, and a `[alert] {json}` log line.
- **Video dry run** — `npm run import-video -- <mp4> [fps]` runs the whole air pipeline over a recording; `recordings/goldens/sessions/air_example_video_0p2fps.session.json` freezes the result (air-only timeline; raises exactly the two-✓ SC ticker and the three badge-less fullscreens).

## Next moves (priority order)

1. **Rehearsal session with all three sources** against the new package (needs the VPN for Chameleon and DDHQ queries for the Nov 3 races). Promote 1–2 real frames with `capture-golden -- --from-session`, freeze a second full session golden, and confirm the identity resolver links the new air headings (proposal-driven; a human accepts in the `RaceLinks` panel).
2. **Rule: votes up while pct_in down** (plan 2.3, user's call). Catches upstream inflation at onset instead of at correction.
3. **Fixtures** — a Chameleon General-election contest sample and a DDHQ statewide (Senate/Governor) sample in the repo root; widen the schema tests.
4. **Operator runbook** (`docs/RUNBOOK.md`): launch order (`chrome:debug` → `live` → `:8787`), env vars, which tab, what each alert type means and who owns it, where recordings land, how to accept a race link. Add `WEB_TOKEN` auth only if the view leaves localhost.
5. **Disk** — ~1 GB/hour of frame PNGs at the default cadence; a `prune-session` script or a documented `rm` for old `recordings/<session>/frames/`.
6. **Lint warnings** — five real ones left (array-index keys in three components, one effect dependency).
7. Deferred, unchanged: magic wall (`provider_direct` path), `judge()`, Slack/paging sinks, EC votes, county-level.

## Useful commands

```bash
npm test                                              # 221 tests, hermetic (no API key)
npm run typecheck && npm run lint
npm run live                                          # full live system + web view (needs .env + VPN)
npm run chrome:debug                                  # the DirecTV/Actus Chrome the air capturer attaches to (CDP :9222)
npm run web:build                                     # build the React SPA
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
