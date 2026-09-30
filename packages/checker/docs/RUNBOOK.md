# Eagle Eye — operator runbook

One page for the truck. Dev context lives in [`CLAUDE.md`](../CLAUDE.md); what was built and why in [`PLAN_V2.md`](PLAN_V2.md).

## Before the night

1. **Machine.** Working copy at `~/Developer/airchecker` (this package is `packages/checker`; run every command below from there), `npm install` done at the repo root, `npm install` done in `src/web/client`. `npm test` green.
2. **`.env`** (gitignored, at the repo root) with `GEMINI_API_KEY` (air is read by Gemini 3.8 Flash direct from Google — a prepaid AI Studio project; keep its credits topped up, a depleted project answers 402, and `live` refuses to start without the key), `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET`, `DDHQ_GRANT_TYPE`. Optional: `ANTHROPIC_API_KEY` and `OPENROUTER_API_KEY` (only for `verify` / `measure-call` trials of other models), `DDHQ_BASE_URL` (the production host; DDHQ's integration host `resultsapi-integration.decisiondeskhq.com` is picked with the Production / Integration toggle on the Setup tab in Live mode, saved in settings.sqlite, and takes effect on the next poll), `SIM_BASE_URL` (the simulator for Sim mode, default `http://localhost:8788`), `DDHQ_POLL_INTERVAL_MS` (default 60000), `CAPTURE_MODE` (`interval` | `manual`), `CAPTURE_INTERVAL_MS` (default 9000), `WEB_PORT` (default 8787).
3. **VPN up** — the Chameleon playlist URL is reachable only on the corporate network. Without it the Ross source shows as failing and there is nothing to hold air against.
4. **Disk.** Frames cost ~1 GB per broadcast hour at the 5 s cadence, session sqlites tens of MB per hour. The web view's **Recordings** panel shows free space (red below 10 GB) and each session's size, and **Prune** drops an old session's frame PNGs (its sqlite still replays and freezes). Check it right after launch.
5. **DDHQ queries.** The list persists in `recordings/settings.sqlite` and is edited in the web view ("DDHQ queries"). Each entry is a `/api/v4/races?…` query string, e.g. `race_date=2026-11-03&state=TX&office_id=3`. Nothing is polled until the list is non-empty.

## Launch order

```bash
npm run chrome            # a Chrome with CDP on :9222, opened on the stream player — log in, start playback
npm run backend              # all three sources, recorder on, the web view's API
npm run frontend:dev         # the web view
open http://localhost:5173
```

In the web view's "Air capture" panel pick the tab to grab (DirecTV is the only preset today), confirm the last-frame image shows real video (a black frame means DRM blocked the screenshot — switch tabs), and leave the cadence on interval.

## Reading the view

- **Source health** — `live` / `stale` / `idle` per source. Air goes `stale` whenever no election graphic has been read for two minutes; during programming with no graphics that is normal.
- **On air** — every race read off the screen in the last 30 minutes, once, at the position of its latest read, newest first. A row is a record of that read: what the graphic showed, the Ross state it was held against and what DDHQ was saying (each with the time it was first seen saying it), and what was found wrong. It doesn't change after the read, so a mismatch is still there after the source catches up. The switch above the list keeps only the rows with alerts; the Live tab's badge counts them. "not linked" means the heading fit no one race from DDHQ or Ross, so the read was held against nothing. Click a row for every read of that race and everything each source has said about it.
- **Recent alert events** — every raise and clear this session, newest first; it outlasts the list's 30 minutes. Click a row for the race.
- **Air capture** — the last frame and what the model read from it.

## What the alert types mean

| Type                                                | Means                                                                                   | Owner                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------- |
| `votes_mismatch`                                    | a candidate's votes on air differ from the Ross state the graphic was held against      | us (render)                               |
| `pct_in_mismatch`                                   | air `% IN` is more than a point off that Ross state's                                   | us                                        |
| `name_mismatch`                                     | a name on air is not in the DDHQ roster                                                 | us                                        |
| `premature_call` / `call_mismatch` / `missing_call` | air shows a ✓ neither DDHQ nor Ross had, or lacks one DDHQ made over 3.5 minutes before | us                                        |
| `field_missing`                                     | a required on-air field (the `% IN` badge) did not render                               | us                                        |
| `multiple_winners`                                  | more than one winner shown/called in a single-winner race                               | whoever shows it (us / provider / vendor) |
| `cross_surface_mismatch`                            | two on-air surfaces disagree on the same race                                           | us                                        |
| `vote_drop`                                         | an upstream candidate total fell >5 % and >500 from one state to the next               | observe (upstream)                        |

Only what's on air is checked: a graphic is held against the Ross states of the 35 seconds before it was read (or, with none, the last one before that), and the one it disagrees with least is the one shown beside it. An alert is raised by the **first** read that finds it and cleared by the next read of that race on that graphic that doesn't. Severity: high = act now, medium = look, low = note.

## Rehearsing against the simulator

The **Live / Sim** switch in the app bar picks what all three sources watch. It's locked while monitoring (stop first), and the whole bar turns amber in Sim.

- **Live:** DDHQ on the host picked on the Setup tab (Production or Integration) with the saved query list; Chameleon's real blade (VPN); air from the tab picked on the Air capture tab (DirecTV).
- **Sim:** all three come from the simulator, `packages/simulator` (`npm run server -w simulator`; see its CLAUDE.md), with no VPN and no DDHQ credentials. DDHQ and Chameleon are its mirror; the DDHQ races to poll come from the simulator each poll; air is its `/air/` page in the debug Chrome, opened there automatically if no tab has it (as is the DirecTV player in Live, for the DirecTV preset). Live's query list, host and tab are left as they were.

What the simulator serves:

- **A simulated night** (its "Simulated air" panel): one invented night behind all three sources, with Chameleon 30 s behind DDHQ and the graphics 19 s behind Chameleon, like the real pipeline. "graphics wrong (%)" makes that share of airings wrong on purpose (votes, % in, old figures, a wrong ✓, a misspelled name) while DDHQ and Chameleon stay right. Score the session with `node --env-file-if-exists=../../.env --import tsx src/tools/scoreSimAir.ts <sessionId>` (from `packages/checker`, while that simulator is still running): how well the air was read, how many of the wrong graphics were caught, and how many right ones were flagged.
- **A recorded night** (its recordings list): the recorded DDHQ and Chameleon responses at 1×; air isn't part of a recording. After restarting playback there, stop and start monitoring here.

Each session records which mode it ran in.

## When something looks wrong

- **No air reads at all** — check the capture panel's frame; wrong tab or black frame. `node --env-file-if-exists=../../.env --import tsx src/tools/airProbe.ts` grabs one frame outside the app and reports whether it is real pixels.
- **A read is "not linked"** — its heading fit no race, or more than one. One such read is a misread and the next read of the race links; every read of a race failing means DDHQ and Ross both lack the race (check the DDHQ queries) or the heading has a form the parser doesn't know (`src/identity/airHeading.ts`).
- **Ross idle** — VPN.
- **DDHQ idle** — credentials in `.env`, and the query list is non-empty.
- **Everything paused** — the process log prints `[air] capture error`, `[provider] query failed`, `[vendor] poll error` lines with the cause; `[alert] {…}` lines are the same events as the panel.

## After the night

Everything was recorded under `recordings/<sessionId>` + `.sqlite`. The web view's **Recordings** panel lists them. Useful follow-ups need no API key:

```bash
node --import tsx src/runtime/replayMain.ts <sessionId>                                 # what stood at the end
node --import tsx src/runtime/replayMain.ts <sessionId> --serve --speed=30              # re-watch it in the web view
node --import tsx src/tools/freezeSessionGolden.ts <sessionId> <goldenName>            # freeze it as a regression golden
node --env-file-if-exists=../../.env --import tsx src/tools/captureGolden.ts --from-session <sessionId> <frameHash> <name>   # promote a frame to a vision golden
```
