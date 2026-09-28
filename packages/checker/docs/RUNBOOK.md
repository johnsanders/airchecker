# Eagle Eye — operator runbook

One page for the truck. Dev context lives in [`CLAUDE.md`](../CLAUDE.md); what was built and why in [`PLAN_V2.md`](PLAN_V2.md).

## Before the night

1. **Machine.** Working copy at `~/Developer/airchecker` (this package is `packages/checker`; run every command below from there), `npm install` done at the repo root, `npm run frontend:build` done (rebuild after any client change). `npm test` green.
2. **`.env`** (gitignored, at the repo root) with `ANTHROPIC_API_KEY` (pass 1, Haiku), `GEMINI_API_KEY` (the crop read, Gemini 3.8 Flash direct from Google — a prepaid AI Studio project; keep its credits topped up, a depleted project answers 402 and `live` refuses to start without both keys), `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET`, `DDHQ_GRANT_TYPE`. Optional: `OPENROUTER_API_KEY` (only for `verify` / `measure-call` trials of `vendor/model` IDs), `DDHQ_BASE_URL` (the production host; DDHQ's integration host `resultsapi-integration.decisiondeskhq.com` is picked with the Production / Integration toggle on the Setup tab, saved in settings.sqlite, and takes effect on the next poll), `DDHQ_POLL_INTERVAL_MS` (default 60000), `CAPTURE_MODE` (`interval` | `manual`), `CAPTURE_INTERVAL_MS` (default 5000), `WEB_PORT` (default 8787).
3. **VPN up** — the Chameleon playlist URL is reachable only on the corporate network. Without it the Ross source logs poll errors every minute and the reconciler has nothing to compare air against.
4. **Disk.** Frames cost ~1 GB per broadcast hour at the 5 s cadence, session sqlites tens of MB per hour. The web view's **Recordings** panel shows free space (red below 10 GB) and each session's size, and **Prune** drops an old session's frame PNGs (its sqlite still replays and freezes). Check it right after launch.
5. **DDHQ queries.** The list persists in `recordings/settings.sqlite` and is edited in the web view ("DDHQ queries"). Each entry is a `/api/v4/races?…` query string, e.g. `race_date=2026-11-03&state=TX&office_id=3`. Nothing is polled until the list is non-empty.

## Launch order

```bash
npm run chrome            # a Chrome with CDP on :9222, opened on the stream player — log in, start playback
npm run backend              # all three sources, recorder on, web view
open http://localhost:8787
```

In the web view's "Air capture" panel pick the tab to grab (DirecTV is the only preset today), confirm the last-frame image shows real video (a black frame means DRM blocked the screenshot — switch tabs), and leave the cadence on interval.

## Reading the view

- **Source health** — `live` / `stale` / `idle` per source. Air goes `stale` whenever no election graphic has been read for two minutes; during programming with no graphics that is normal.
- **Races** — one row per race, the three sources side by side. Chips: red = standing alerts, orange = provisional (a Ross or air race not yet linked to a DDHQ race), purple = a pending link proposal.
- **Race links** — Haiku proposes which DDHQ race an air or Ross race is; a human **accepts or rejects**. Nothing is auto-linked by the model. Until a race is linked its air reads reconcile against nothing. Check this panel early and whenever the badge count rises.
- **Alerts** — what stands right now, grouped by race. Clears on the next clean poll.
- **Recent alert events** — every raise and clear this session, newest first. This is where a one-poll event stays visible. Click a row for the race.
- **Air capture** — the last frame and what the model read from it.

## What the alert types mean

| Type | Means | Owner |
| --- | --- | --- |
| `votes_mismatch` | air vote total matches no vendor snapshot in the lag window | us (render) |
| `pct_in_mismatch` | air `% IN` off from every vendor snapshot in the window | us |
| `name_mismatch` | a name on air is not in the DDHQ roster | us |
| `premature_call` / `call_mismatch` / `missing_call` | air ✓ vs DDHQ's call disagree | us |
| `field_missing` | a required on-air field (the `% IN` badge) did not render | us |
| `multiple_winners` | more than one winner shown/called in a single-winner race | whoever shows it (us / provider / vendor) |
| `cross_surface_mismatch` | two on-air surfaces disagree on the same race | us |
| `vote_drop` | an upstream candidate total fell >5 % and >500 between polls | observe (upstream) |
| `air_ahead_of_upstream` | air shows more votes than any provider snapshot yet | observe |

Air alerts fire on the **first** bad graphic seen; they clear after three clean reconciles. Severity: high = act now, medium = look, low = note.

## Rehearsing against a recorded night

Recording the APIs and playing them back live in the simulator package, `packages/simulator` (see its CLAUDE.md; `npm run server` there). While the simulator plays a recording, pick **Sim** as the environment on the Setup tab: DDHQ and Chameleon are both polled from the simulator's mirror (`SIM_BASE_URL`, default `http://localhost:8788`), with no VPN and no DDHQ credentials. Paste the recording's DDHQ queries (shown in the simulator's playback banner) into the query list. Playback runs at 1×; after restarting it in the simulator, stop and start monitoring here. Race links made in Sim are saved like any others.

## When something looks wrong

- **No air reads at all** — check the capture panel's frame; wrong tab or black frame. `node --env-file-if-exists=../../.env --import tsx src/tools/airProbe.ts` grabs one frame outside the app and reports whether it is real pixels.
- **A race never links** — accept or reject the proposal in Race links, or relink manually from the race's detail dialog.
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
