import type { FastifyInstance } from 'fastify';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CandidateState, RaceObservation, SourceName } from '../reconcile/reconcile.js';
import type { SessionFiles } from '../replay/sessionFiles.js';
import type { CheckedRead, Composition } from '../runtime/composition.js';
import type { SessionStatus } from '../runtime/liveSession.js';
import type { SourceError } from '../runtime/sourceErrors.js';
import type { CadenceConfig, CaptureResult } from '../sources/air/captureScheduler.js';
import type { MatchStore } from '../sources/air/matchStore.js';
import type { DdhqHost, Mode } from '../sources/provider/providerSource.js';
import type { QueryStore } from '../sources/provider/queryStore.js';
import type { ChangeBus } from './changeBus.js';

import { normalizeName } from '../reconcile/reconcile.js';

// The live web view at localhost:8787. The React SPA (src/web/client) is served as
// static files; everything else is a JSON API over injected handles — no source
// logic lives here.

export type LastFrameView = {
	hash: string;
	observations: RaceObservation[];
	png: Buffer;
	ts: number;
};

export type WebServerConfig = {
	// When present, the server opens a /ws endpoint and pushes a "changed" nudge over
	// it on every state change, so the client refetches on demand instead of polling.
	changeBus?: ChangeBus;
	composition: Pick<Composition, 'alertLog' | 'latestReads' | 'readsOf' | 'store'>;
	// Which DDHQ host Live mode polls (production or integration); omitted if DDHQ isn't wired.
	ddhqHost?: { get: () => DdhqHost; set: (next: DdhqHost) => void };
	getCadence?: () => CadenceConfig;
	getLastFrame?: () => LastFrameView | undefined;
	getSourceError?: (source: SourceName) => SourceError | undefined; // current poll/capture failure
	// When the source last answered a poll or capture; omitted in replay, where the latest
	// thing it said stands in.
	getSourceLastOk?: (source: SourceName) => number | undefined;
	matchStore?: MatchStore; // Live mode's air tab URL-match get/set; omitted if air isn't wired
	// Live (the real sources) or Sim (the simulator on all three); omitted if not switchable.
	mode?: { get: () => Mode; set: (next: Mode) => void };
	queryStore?: QueryStore; // DDHQ queries get/set; omitted if DDHQ isn't configured
	// Monitoring on/off (live only): stop closes the session recording and halts polling
	// and capture; start opens a new session. Omitted in replay.
	session?: { start: () => SessionStatus; status: () => SessionStatus; stop: () => SessionStatus };
	// Recorded sessions + disk space (Recordings panel); omitted if not wired.
	sessions?: SessionFiles;
	setCadence?: (next: Partial<CadenceConfig>) => void;
	// Manual capture trigger (air scheduler's triggerCapture); omitted if air isn't wired.
	triggerCapture?: () => Promise<CaptureResult>;
};

const SOURCES: readonly SourceName[] = ['DDHQ', 'Ross', 'air'];

// Strip the Buffer from an observation for JSON (frames live behind /api/last-frame).
const serializeObservation = (o: RaceObservation): Omit<RaceObservation, never> => o;

type RaceCell = { called: boolean; pct: number; votes: number };

// calledFor holds the source's own candidate keys, which for air are names.
const cellFor = (observation: RaceObservation, candidate: CandidateState): RaceCell => {
	const id = normalizeName(candidate.name);
	return {
		called: (observation.calledFor ?? []).some(
			(key) => key === candidate.key || normalizeName(key) === id,
		),
		pct: candidate.pct,
		votes: candidate.votes,
	};
};

// One air read as the web view shows it: what the graphic showed, beside the Ross state
// it was held against and what DDHQ was saying, for the candidates on the graphic.
const airRead = (checked: CheckedRead) => {
	const air = checked.read;
	const perSource: { observation: RaceObservation | undefined; source: SourceName }[] = [
		{ observation: checked.provider, source: 'DDHQ' },
		{ observation: checked.vendor, source: 'Ross' },
		{ observation: air, source: 'air' },
	];
	return {
		airedAt: air.observedAt,
		anomalies: checked.anomalies.map((anomaly) => ({
			detail: anomaly.detail,
			severity: anomaly.severity,
			type: anomaly.type,
		})),
		candidates: air.candidates.map((candidate) => ({
			cells: Object.fromEntries(
				perSource.flatMap(({ observation, source }) => {
					const match = observation?.candidates.find(
						(other) => normalizeName(other.name) === normalizeName(candidate.name),
					);
					return observation === undefined || match === undefined
						? []
						: [[source, cellFor(observation, match)]];
				}),
			) as Partial<Record<SourceName, RaceCell>>,
			name: candidate.name,
			party: candidate.party,
		})),
		heading: air.sourceRaceKey ?? air.raceKey,
		linked: air.raceKey !== air.sourceRaceKey,
		pctIn: Object.fromEntries(
			perSource.map(({ observation, source }) => [source, observation?.pctIn ?? null]),
		) as Record<SourceName, null | number>,
		pctInIsMinimum: air.pctInIsMinimum === true,
		raceKey: air.raceKey,
		// When each source was first seen saying what the row shows of it.
		saidAt: Object.fromEntries(
			perSource.map(({ observation, source }) => [source, observation?.observedAt ?? null]),
		) as Record<SourceName, null | number>,
		templateId: air.templateId ?? null,
	};
};

const clientDistDir = (): string => {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, 'client', 'dist');
};

export const makeWebServer = (config: WebServerConfig): FastifyInstance => {
	const app = Fastify();

	// --- Live push (websocket) -----------------------------------------------
	// @fastify/websocket registers via fastify-plugin, so its onRoute hook is global
	// once loaded. Defining /ws inside a child register() (queued after the plugin)
	// guarantees the hook is installed before the route is added — the route then
	// upgrades to a websocket. Each connection just relays bus "changed" nudges.
	const changeBus = config.changeBus;
	if (changeBus !== undefined) {
		void app.register(fastifyWebsocket);
		void app.register(async (instance) => {
			instance.get('/ws', { websocket: true }, (socket) => {
				const off = changeBus.subscribe((message) => {
					if (socket.readyState === 1) socket.send(JSON.stringify(message));
				});
				socket.on('close', off);
			});
		});
	}

	// --- API -----------------------------------------------------------------

	app.get('/api/state', () => {
		const store = config.composition.store;
		const raceKeys = store.getRaceKeys();
		const sources = SOURCES.map((source) => {
			const histories = raceKeys.map((raceKey) => store.getHistory(source, raceKey));
			const observations = histories.reduce((sum, h) => sum + h.length, 0);
			const races = histories.filter((h) => h.length > 0).length;
			const lastSaid = Math.max(0, ...histories.flat().map((o) => o.observedAt));
			return {
				error: config.getSourceError?.(source) ?? null,
				// Air's is its last graphic read: no graphics for a while is worth seeing, and
				// every read is stored. DDHQ and Ross answer every poll but are stored only when
				// what they say changes.
				lastAt:
					(source === 'air' ? undefined : config.getSourceLastOk?.(source)) ??
					(lastSaid > 0 ? lastSaid : null),
				observations,
				races,
				source,
			};
		});
		const lastFrame = config.getLastFrame?.();
		return {
			airMatch: config.matchStore?.get() ?? null,
			cadence: config.getCadence?.() ?? null,
			ddhqHost: config.ddhqHost?.get() ?? null,
			lastFrame:
				lastFrame === undefined
					? null
					: { observations: lastFrame.observations.map(serializeObservation), ts: lastFrame.ts },
			mode: config.mode?.get() ?? null,
			session: config.session?.status() ?? null,
			sources,
		};
	});

	// The on-air list: each race read off air in the store's 30 minutes, once, as its latest
	// read, newest first.
	app.get('/api/races', () => ({ races: config.composition.latestReads().map(airRead) }));

	// One race: every read of it still held, newest first, and every observation of it
	// from all three sources.
	app.get<{ Params: { raceKey: string } }>('/api/race/:raceKey', (req) => {
		const raceKey = decodeURIComponent(req.params.raceKey);
		return {
			observations: SOURCES.flatMap((source) =>
				config.composition.store.getHistory(source, raceKey),
			)
				.sort((left, right) => right.observedAt - left.observedAt)
				.map(serializeObservation),
			raceKey,
			reads: config.composition.readsOf(raceKey).map(airRead),
		};
	});

	app.get<{ Querystring: { limit?: string } }>('/api/alert-history', (req) => {
		const parsed = Number(req.query.limit);
		const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 100;
		return { events: config.composition.alertLog.recent(limit) };
	});

	app.get('/api/last-frame', (_req, reply) => {
		const frame = config.getLastFrame?.();
		if (frame === undefined) return reply.code(404).send({ error: 'no frame' });
		return reply.type('image/png').send(frame.png);
	});

	app.post('/api/capture', async (_req, reply) => {
		if (config.triggerCapture === undefined)
			return reply.code(503).send({ error: 'air capture not wired', ran: false, status: 'error' });
		if (config.session?.status().running === false)
			return reply.code(409).send({ error: 'monitoring is stopped', ran: false, status: 'error' });
		const result = await config.triggerCapture();
		// ran → success; skipped → busy; error → carry the real message so the UI is honest.
		if (result.status === 'error')
			return reply.code(500).send({ error: result.message, ran: false, status: 'error' });
		return { ran: result.status === 'ran', status: result.status };
	});

	app.get('/api/cadence', (_req, reply) => {
		const cadence = config.getCadence?.();
		if (cadence === undefined) return reply.code(503).send({ error: 'cadence control not wired' });
		return cadence;
	});

	app.post<{ Body: { intervalMs?: unknown; mode?: unknown } }>('/api/cadence', (req, reply) => {
		if (config.setCadence === undefined || config.getCadence === undefined)
			return reply.code(503).send({ error: 'cadence control not wired' });
		const next: Partial<CadenceConfig> = {};
		if (req.body.mode === 'interval' || req.body.mode === 'manual') next.mode = req.body.mode;
		if (typeof req.body.intervalMs === 'number' && req.body.intervalMs > 0)
			next.intervalMs = req.body.intervalMs;
		config.setCadence(next);
		changeBus?.broadcast({ type: 'changed' });
		return config.getCadence();
	});

	app.get('/api/queries', () => ({ queries: config.queryStore?.get() ?? [] }));

	app.post<{ Body: { queries?: unknown } }>('/api/queries', (req, reply) => {
		if (config.queryStore === undefined)
			return reply.code(503).send({ error: 'DDHQ not configured' });
		const raw = req.body.queries;
		if (!Array.isArray(raw) || !raw.every((q) => typeof q === 'string'))
			return reply.code(400).send({ error: 'queries must be an array of strings' });
		config.queryStore.set(raw);
		changeBus?.broadcast({ type: 'changed' });
		return { queries: config.queryStore.get() };
	});

	app.post<{ Body: { host?: unknown } }>('/api/ddhq-host', (req, reply) => {
		if (config.ddhqHost === undefined)
			return reply.code(409).send({ error: 'DDHQ host is not switchable here' });
		const host = req.body.host;
		if (host !== 'production' && host !== 'integration')
			return reply.code(400).send({ error: 'host must be production or integration' });
		config.ddhqHost.set(host);
		changeBus?.broadcast({ type: 'changed' });
		return { host: config.ddhqHost.get() };
	});

	// Refused while monitoring, so one session never mixes live and simulated sources.
	app.post<{ Body: { mode?: unknown } }>('/api/mode', (req, reply) => {
		if (config.mode === undefined)
			return reply.code(409).send({ error: 'mode is not switchable here' });
		const mode = req.body.mode;
		if (mode !== 'live' && mode !== 'sim')
			return reply.code(400).send({ error: 'mode must be live or sim' });
		if (config.session?.status().running === true && mode !== config.mode.get())
			return reply
				.code(409)
				.send({ error: 'stop monitoring before switching between Live and Sim' });
		config.mode.set(mode);
		changeBus?.broadcast({ type: 'changed' });
		return { mode: config.mode.get() };
	});

	// Which browser tab the air capturer grabs (URL substring), switchable live.
	app.get('/api/air-match', () => ({ match: config.matchStore?.get() ?? null }));

	app.post<{ Body: { match?: unknown } }>('/api/air-match', (req, reply) => {
		if (config.matchStore === undefined)
			return reply.code(503).send({ error: 'air capture not wired' });
		if (typeof req.body.match !== 'string' || req.body.match.trim().length === 0)
			return reply.code(400).send({ error: 'match must be a non-empty string' });
		config.matchStore.set(req.body.match);
		changeBus?.broadcast({ type: 'changed' });
		return { match: config.matchStore.get() };
	});

	app.post('/api/session/start', (_req, reply) => {
		if (config.session === undefined) return reply.code(503).send({ error: 'sessions not wired' });
		const status = config.session.start();
		changeBus?.broadcast({ type: 'changed' });
		return status;
	});

	app.post('/api/session/stop', (_req, reply) => {
		if (config.session === undefined) return reply.code(503).send({ error: 'sessions not wired' });
		const status = config.session.stop();
		changeBus?.broadcast({ type: 'changed' });
		return status;
	});

	// Recorded sessions, free disk, pruning a session's frame PNGs, and deleting a session.
	app.get('/api/sessions', (_req, reply) => {
		if (config.sessions === undefined)
			return reply.code(503).send({ error: 'session files not wired' });
		return { disk: config.sessions.disk(), sessions: config.sessions.list() };
	});

	app.delete<{ Params: { id: string } }>('/api/sessions/:id', (req, reply) => {
		if (config.sessions === undefined)
			return reply.code(503).send({ error: 'session files not wired' });
		try {
			return { freedBytes: config.sessions.deleteSession(req.params.id) };
		} catch (error) {
			return reply
				.code(409)
				.send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	app.post<{ Params: { id: string } }>('/api/sessions/:id/prune-frames', (req, reply) => {
		if (config.sessions === undefined)
			return reply.code(503).send({ error: 'session files not wired' });
		try {
			return { freedBytes: config.sessions.pruneFrames(req.params.id) };
		} catch (error) {
			return reply
				.code(409)
				.send({ error: error instanceof Error ? error.message : String(error) });
		}
	});

	// --- Static SPA ----------------------------------------------------------

	const distDir = clientDistDir();
	if (existsSync(join(distDir, 'index.html'))) {
		void app.register(fastifyStatic, { root: distDir });
		// SPA fallback for any non-API route.
		app.setNotFoundHandler((req, reply) => {
			if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
			return reply.sendFile('index.html');
		});
	} else {
		app.get('/', (_req, reply) =>
			reply
				.type('text/html')
				.send(
					'<h1>Eagle Eye</h1><p>Web UI not built. Run <code>npm run frontend:build</code>, then restart.</p>',
				),
		);
	}

	return app;
};
