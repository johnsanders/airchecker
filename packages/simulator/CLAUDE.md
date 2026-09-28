# simulator

Repo-wide conventions (coding style, working style, TypeScript rules, lint, the root `.env`) are in the [root CLAUDE.md](../../CLAUDE.md). Everything here assumes cwd `packages/simulator`.

The simulator (formerly the sibling repo `elex_sim`) simulates election night for the [checker](../checker/CLAUDE.md) (Eagle Eye), which observes live results and on-air graphics and flags inconsistencies. It records the raw DDHQ and Chameleon API responses and plays them back on mirror endpoints that answer the same paths as the real services. It also holds the hand-built on-air graphics that a simulated air feed will render.

## Quick start

```bash
npm test                 # this package only (npm test at the repo root runs both)
npm run frontend:build   # once, and after client changes
npm run server           # http://localhost:8788 (PORT to change)
```

## Layout

```
src/
  main.ts           composition + listen
  settings.ts       what the recorder polls (DDHQ query list, host, sample interval), in settings.json
  sources/          HttpJson over fetch, DDHQ OAuth (copied from the checker)
  recording/        API recording sqlite format, recorder (Record button), record loop (sample interval from settings, default 60 s), recording HTTP wrapper
  playback/         playback clock (1× only) + the mirror's answers
  air/airFeed.ts    STUB: the simulated 1920×1080 air feed, called on every playback start/pause/resume/restart/stop
  web/              Fastify control API + mirror (server.ts), Vite/React/MUI SPA (client/)
tests/              vitest
ticker.html, l3.html, fullscreen.html   the three on-air graphics (1920×1080 HTML/CSS from the PSDs)
render-*.mjs, compare.html               render a graphic to PNG; compare a build with its design (not linted)
```

## How it fits with the checker

- **Recording.** Record polls DDHQ (every query, every page) and the Chameleon playlist every sample interval (5–3600 s, default 60, set under "What to record"). It needs `DDHQ_CLIENT_ID`, `DDHQ_CLIENT_SECRET` and `DDHQ_GRANT_TYPE` in the root `.env`, and the VPN for Chameleon. Only GETs are recorded; the OAuth POST never reaches disk. Recordings live in `recordings/api/<name>.sqlite`. The checker used to write the same format, so its older recordings play here unchanged.
- **Playback.** Play serves one recording on the mirror:
  - `POST /api/v4/oauth/token` returns a fake token.
  - `GET /api/v4/*` (DDHQ) and `GET /chameleon/*` (the Chameleon blade) answer with the response recorded for that exact path and query, the latest one at or before the playback clock.
  - Status codes: 503 when nothing is playing, 404 for a path that was never recorded (or not recorded yet), 502 with the original message when the recorded response was an error.
- **The checker's Sim environment** points both of its pollers at this server (`SIM_BASE_URL`, default `http://localhost:8788`). Its DDHQ query list must match the recording's; the playback banner shows them. When playback restarts, stop and start monitoring in the checker.
- **Air feed (not built).** `src/air/airFeed.ts` is where a 1920×1080 video of the three graphics, driven by the recording at the playback clock, will play for the checker to capture by URL match.
- **No shared code yet.** `src/sources/` is a copy of the checker's DDHQ auth and HTTP helpers. Now that both live in one repo, they could be shared; don't do it without asking.
