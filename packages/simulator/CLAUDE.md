# simulator

Repo-wide conventions (coding style, working style, TypeScript rules, lint, the root `.env`) are in the [root CLAUDE.md](../../CLAUDE.md). Everything here assumes cwd `packages/simulator`.

The simulator (formerly the sibling repo `elex_sim`) simulates election night for the [checker](../checker/CLAUDE.md) (Eagle Eye), which observes live results and on-air graphics and flags inconsistencies. It records the raw DDHQ and Chameleon API responses and plays them back on mirror endpoints that answer the same paths as the real services. It also serves a simulated air feed at `/air/`: the hand-built on-air graphics over a looping newscast, filled from an invented election night, for the checker to capture in place of DirecTV.

## Quick start

```bash
npm test                 # this package only (npm test at the repo root runs both)
npm run frontend:build   # once, and after client changes
npm run server           # http://localhost:8788 (PORT to change)
npm run frontend:dev     # hot-reload control page on :5174, proxied to :8788
```

## Layout

```
src/
  main.ts           composition + listen
  settings.ts       what the recorder polls (DDHQ query list, host, sample interval), in settings.json
  sources/          HttpJson over fetch, DDHQ OAuth (copied from the checker)
  recording/        API recording sqlite format, recorder (Record button), record loop (sample interval from settings, default 60 s), recording HTTP wrapper
  playback/         playback clock (1× only) + the mirror's answers
  air/              the simulated air feed: races.ts (races.json), night.ts (the invented results), schedule.ts (what airs when), airShow.ts (runs a night);
                    airFeed.ts is an unused set of playback hooks for a recording-driven feed
  web/              Fastify control API + mirror (server.ts), Vite/React/MUI SPA (client/)
  tools/buildRaces.ts   takeitems.xml + one DDHQ lookup → races.json (run once; see the file header)
tests/              vitest
ticker.html, l3.html, fullscreen.html   the three on-air graphics (1920×1080 HTML/CSS from the PSDs); window.renderGraphic(data) fills one
air.html                 the air feed page: background video + the three graphics in iframes, polling /api/air/now
takeitems.xml            the operator's Ross take list for the L3 and FS results graphics (races, no candidates)
races.json               the simulated air feed's races: the take list's 116 races with DDHQ candidates and race_id
render-*.mjs, compare.html               render a graphic to PNG; compare a build with its design (not linted)
```

## How it fits with the checker

- **Recording.** Record polls DDHQ (every query, every page) and the Chameleon playlist every sample interval (5–3600 s, default 60, set under "What to record"). It needs `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET` and `DDHQ_GRANT_TYPE` in the root `.env`, and the VPN for Chameleon. Only GETs are recorded; the OAuth POST never reaches disk. Recordings live in `recordings/api/<name>.sqlite`. The checker used to write the same format, so its older recordings play here unchanged.
- **Playback.** Play serves one recording on the mirror:
  - `POST /api/v4/oauth/token` returns a fake token.
  - `GET /api/v4/*` (DDHQ) and `GET /chameleon/*` (the Chameleon blade) answer with the response recorded for that exact path and query, the latest one at or before the playback clock.
  - Status codes: 503 when nothing is playing, 404 for a path that was never recorded (or not recorded yet), 502 with the original message when the recorded response was an error.
- **The checker's Sim environment** points both of its pollers at this server (`SIM_BASE_URL`, default `http://localhost:8788`). Its DDHQ query list must match the recording's; the playback banner shows them. When playback restarts, stop and start monitoring in the checker.
- **Air feed.** "Simulated air" on the control page starts a night (default 30 min); `/air/` shows it at 1920×1080, scaled to the window.
  - **What airs.** The ticker is always up and moves to the next race every 8 s, through all 116 races in a shuffled order. Every 10–20 s an L3 or FS comes up over the program for 10 s.
  - **The results are invented** (`night.ts`, seeded): each race gets hidden final numbers and a reporting window. % in and votes only rise, shares settle from an early lean, and a race is called once enough is in for its margin (a blowout at poll close, a very close one never). Once the night's length is up everything holds its final numbers and keeps cycling.
  - **Layout rules.** The Democrat is always left (cand1) and the Republican right (cand2); with no Democrat, the likeliest opponent (I, then L) takes the left. House races read `FL-22`. No headshots.
  - **The newscast** is `recordings/air/background.mp4` (gitignored, so each machine supplies its own): a clip of NewsNation air with no election graphics in it, so everything the checker reads comes from the simulator.
  - **In the checker**, open `http://localhost:8788/air/` in the debug Chrome and pick the "Sim air" capture preset. The program under the ticker (newscast, L3, FS) is squeezed back as on air: up 42 px and scaled to .979 tall from the top.
- **No shared code yet.** `src/sources/` is a copy of the checker's DDHQ auth and HTTP helpers. Now that both live in one repo, they could be shared; don't do it without asking.
