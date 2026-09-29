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
  settings.ts       what the recorder polls (DDHQ query list, host, sample interval) and a night's airSource (invented or ddhqIntegration), in settings.json
  sources/          HttpJson over fetch, DDHQ OAuth (copied from the checker)
  recording/        API recording sqlite format, recorder (Record button), record loop (sample interval from settings, default 60 s), recording HTTP wrapper
  playback/         playback clock (1× only) + the mirror's answers
  air/              the simulated night: races.ts (races.json), night.ts (the invented results and source lags), liveResults.ts (a night's numbers pulled from DDHQ's integration host instead), schedule.ts (what airs when), faults.ts (what's wrong with an airing, when something is), nightMirror.ts (the night as DDHQ and Chameleon responses), airShow.ts (runs a night, or puts a playing recording on air through its airFeed.ts hooks), recordedResults.ts (a recording's Chameleon numbers per race)
  web/              Fastify control API + mirror (server.ts), Vite/React/MUI SPA (client/)
  tools/buildRaces.ts   takeitems.xml + one DDHQ lookup → races.json (run once; see the file header)
tests/              vitest
ticker.html, l3.html, fullscreen.html   the three on-air graphics (1920×1080 HTML/CSS from the PSDs); window.renderGraphic(data) fills one
air.html                 the air feed page: background video + the three graphics in iframes, polling /api/air/now
takeitems.xml            the operator's Ross take list for the L3 and FS results graphics (races, no candidates)
races.json               the simulated night's races: the take list's 116 races with DDHQ's race and candidate ids, names, parties and office fields
render-*.mjs, compare.html               render a graphic to PNG; compare a build with its design (not linted)
```

## How it fits with the checker

- **Recording.** Record polls DDHQ (every query, every page) and the Chameleon playlist every sample interval (5–3600 s, default 60, set under "What to record"). It needs `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET` and `DDHQ_GRANT_TYPE` in the root `.env`, and the VPN for Chameleon. Only GETs are recorded; the OAuth POST never reaches disk. Recordings live in `recordings/api/<name>.sqlite`. The checker used to write the same format, so its older recordings play here unchanged.
- **Playback.** Play serves one recording on the mirror:
  - `POST /api/v4/oauth/token` returns a fake token.
  - `GET /api/v4/*` (DDHQ) and `GET /chameleon/*` (the Chameleon blade) answer with the response recorded for that exact path and query, the latest one at or before the playback clock.
  - Status codes: 503 when nothing is playing, 404 for a path that was never recorded (or not recorded yet), 502 with the original message when the recorded response was an error.
- **The checker's Sim mode** points all three of its sources here (`SIM_BASE_URL`, default `http://localhost:8788`): DDHQ and Chameleon at the mirror, air at `/air/`. It asks `GET /api/sim/queries` which DDHQ queries to poll: the running night's races (`race_ids=`, 50 per query), or the playing recording's queries. When playback restarts, stop and start monitoring in the checker.
- **One thing serves the mirror at a time.** Starting a night stops recording playback, and starting playback stops the night.
- **A recording on air.** Playing a recording also puts it on `/air/`: the take-list races its Chameleon playlists carry (matched by `raceID`; candidates by name, since Chameleon's choice ids are its own), each showing its contest from the last playlist recorded 19 s earlier, as graphics trail Chameleon. Before the first poll, the first poll's numbers show. Pause, resume and restart move the air with the playback; a recording with no take-list race airs nothing. The mirrors keep answering from the recording itself.
- **A simulated night.** "Simulated air" on the control page starts a night (default 30 min). While it runs, the DDHQ and Chameleon mirrors serve it (`nightMirror.ts`, in the shapes the checker parses, with the DDHQ race and candidate ids from races.json) and `/air/` shows it at 1920×1080, scaled to the window.
  - **Lagged like the real pipeline** (`night.ts`): DDHQ has each drop first, Chameleon 30 s later, the graphics 19 s after that (the middle of the checker's 3–35 s air-to-Chameleon window). Every source carries the same whole-vote counts, so percents never disagree by rounding.
  - **Ground truth.** `GET /api/air/aired?ts=` says what was on screen at any moment of any night this process ran, and what if anything was wrong with it; the checker's `scoreSimAir.ts` scores a session against it.
  - **Wrong graphics, on request.** "graphics wrong (%)" next to Start (`faultPercent` on `POST /api/air/start`, default 0) is the share of airings that put something wrong on air, while DDHQ and Chameleon go on saying what's true. An airing is one ticker slot, or one L3 or FS from up to down, and is wrong one way for as long as it's up (`faults.ts`): `votes` (a candidate has 1–10 % more votes than they have, at least 100), `pctIn` (3–15 points off), `stale` (the race as it stood five minutes before), `check` (a ✓ for the leader of a race DDHQ hasn't called, or on the loser of one it has), `name` (two neighboring letters of a surname swapped). Which airings and how comes from the night's seed. A fault that would change nothing, such as old figures that are still the figures, leaves the airing right, so everything `fault` names is visibly wrong on screen. Without faults the simulator can only show that the checker raises no false alarm; with them, that it catches what it's for.
  - **What airs.** The ticker is always up and moves to the next race every 8 s, through all 116 races in a shuffled order. Every 10–20 s an L3 or FS comes up over the program for 10 s.
  - **The results are invented by default** (`night.ts`, seeded): each race gets hidden final numbers and a reporting window, with results landing in drops 1–2.5 min apart. % in (a whole number) and votes only rise, shares settle from an early lean, and a race is called once enough is in for its margin (a blowout at poll close, a very close one never). Once the night's length is up everything holds its final numbers and keeps cycling.
  - **Or, during a DDHQ testing window, pulled live from DDHQ's integration host.** The airSource setting (invented / DDHQ integration, on the control page next to Start) picks which a night uses, decided once at Start — changing it mid-night takes effect on the next one. In DDHQ integration mode, `liveResults.ts` polls every race in races.json by `race_ids` (50 per request) every 60 s (DDHQ's own integration cache interval), started and stopped with the night; air, DDHQ and Chameleon all read that cache instead of `raceAt`, so there's no lag simulation and a race not yet in the cache just reads as not started. Poll failures show on the control page.
  - **Layout rules.** The Democrat is always left (cand1) and the Republican right (cand2); with no Democrat, the likeliest opponent (I, then L) takes the left. House races read `FL-22`. No headshots.
  - **The newscast** is `recordings/air/background.mp4` (gitignored, so each machine supplies its own): a clip of NewsNation air with no election graphics in it, so everything the checker reads comes from the simulator.
  - **In the checker**, switch to Sim; it opens `http://localhost:8788/air/` in its debug Chrome if no tab has it. The program under the ticker (newscast, L3, FS) is squeezed back as on air: up 42 px and scaled to .979 tall from the top.
- **No shared code yet.** `src/sources/` is a copy of the checker's DDHQ auth and HTTP helpers. Now that both live in one repo, they could be shared; don't do it without asking.
