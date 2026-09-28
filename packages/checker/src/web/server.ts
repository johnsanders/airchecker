import type { FastifyInstance } from 'fastify';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RaceAlias, RaceIdentityResolver } from '../identity/raceIdentity.js';
import type { Anomaly, RaceObservation, SourceName } from '../reconcile/reconcile.js';
import type { SessionFiles } from '../replay/sessionFiles.js';
import type { AlertEvent } from '../runtime/alertLog.js';
import type { SessionStatus } from '../runtime/liveSession.js';
import type { SourceError } from '../runtime/sourceErrors.js';
import type { CadenceConfig, CaptureResult } from '../sources/air/captureScheduler.js';
import type { MatchStore } from '../sources/air/matchStore.js';
import type { DdhqHost, Mode } from '../sources/provider/providerSource.js';
import type { QueryStore } from '../sources/provider/queryStore.js';
import type { Store } from '../store/store.js';
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
	// Which DDHQ host Live mode polls (production or integration); omitted if DDHQ isn't wired.
	ddhqHost?: { get: () => DdhqHost; set: (next: DdhqHost) => void };
	// Newest-first raise/clear events; omitted if alert history isn't wired.
	getAlertHistory?: (limit?: number) => AlertEvent[];
	getCadence?: () => CadenceConfig;
	getLastFrame?: () => LastFrameView | undefined;
	getRecentAlerts: () => Anomaly[];
	getSourceError?: (source: SourceName) => SourceError | undefined; // current poll/capture failure
	matchStore?: MatchStore; // Live mode's air tab URL-match get/set; omitted if air isn't wired
	// Live (the real sources) or Sim (the simulator on all three); omitted if not switchable.
	mode?: { get: () => Mode; set: (next: Mode) => void };
	onRaceRelink?: (source: SourceName, sourceRaceKey: string, canonicalRaceKey: string) => void;
	queryStore?: QueryStore; // DDHQ queries get/set; omitted if DDHQ isn't configured
	raceIdentity?: RaceIdentityResolver;
	reconcileRace?: (raceKey: string, now: number) => Anomaly[];
	// Monitoring on/off (live only): stop closes the session recording and halts polling
	// and capture; start opens a new session. Omitted in replay.
	session?: { start: () => SessionStatus; status: () => SessionStatus; stop: () => SessionStatus };
	// Recorded sessions + disk space (Recordings panel); omitted if not wired.
	sessions?: SessionFiles;
	setCadence?: (next: Partial<CadenceConfig>) => void;
	store: Store;
	// Manual capture trigger (air scheduler's triggerCapture); omitted if air isn't wired.
	triggerCapture?: () => Promise<CaptureResult>;
};

const SOURCES: readonly SourceName[] = ['DDHQ', 'Ross', 'air'];

const historyFor = (store: Store, source: SourceName, raceKey: string): RaceObservation[] => {
	if (source === 'DDHQ') return store.getProviderHistory(raceKey);
	if (source === 'Ross') return store.getVendorHistory(raceKey);
	return store.getAirHistory(raceKey);
};

const latest = (history: RaceObservation[]): RaceObservation | undefined =>
	history.length === 0 ? undefined : history[history.length - 1];

const aliasFor = (
	resolver: RaceIdentityResolver | undefined,
	observation: RaceObservation | undefined,
): RaceAlias | undefined =>
	observation === undefined
		? undefined
		: resolver?.getAlias(observation.source, observation.sourceRaceKey ?? observation.raceKey);

// Strip the Buffer from an observation for JSON (frames live behind /api/last-frame).
const serializeObservation = (o: RaceObservation): Omit<RaceObservation, never> => o;

type RaceSourceSummary = {
	candidates: { called: boolean; name: string; party: string; pct: number; votes: number }[];
	pctIn: null | number;
	present: boolean;
};

// Compact per-source view for the races table: pctIn + candidates sorted by votes
// desc (the UI shows the top few + a "more" hint). called is matched within the
// source's own keys (with a name fallback) since calledFor holds that source's keys.
const summarizeSource = (observation: RaceObservation | undefined): RaceSourceSummary => {
	if (observation === undefined) return { candidates: [], pctIn: null, present: false };
	const calledKeys = observation.calledFor ?? [];
	const candidates = [...observation.candidates]
		.sort((a, b) => b.votes - a.votes || b.pct - a.pct || a.name.localeCompare(b.name))
		.map((candidate) => ({
			called: calledKeys.some(
				(key) => key === candidate.key || normalizeName(key) === normalizeName(candidate.name),
			),
			name: candidate.name,
			party: candidate.party,
			pct: candidate.pct,
			votes: candidate.votes,
		}));
	return { candidates, pctIn: observation.pctIn, present: true };
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
		const store = config.store;
		const raceKeys = store.getRaceKeys();
		const sources = SOURCES.map((source) => {
			const histories = raceKeys.map((raceKey) => historyFor(store, source, raceKey));
			const observations = histories.reduce((sum, h) => sum + h.length, 0);
			const races = histories.filter((h) => h.length > 0).length;
			const lastAt = Math.max(0, ...histories.flat().map((o) => o.observedAt));
			return {
				error: config.getSourceError?.(source) ?? null,
				lastAt: lastAt > 0 ? lastAt : null,
				observations,
				races,
				source,
			};
		});
		const lastFrame = config.getLastFrame?.();
		return {
			airMatch: config.matchStore?.get() ?? null,
			alerts: config.getRecentAlerts().slice(-100).reverse(),
			cadence: config.getCadence?.() ?? null,
			ddhqHost: config.ddhqHost?.get() ?? null,
			lastFrame:
				lastFrame === undefined
					? null
					: { observations: lastFrame.observations.map(serializeObservation), ts: lastFrame.ts },
			mode: config.mode?.get() ?? null,
			pendingLinkCount:
				config.raceIdentity
					?.getSnapshot()
					.proposals.filter((proposal) => proposal.status === 'pending').length ?? 0,
			session: config.session?.status() ?? null,
			sources,
		};
	});

	// Race list, most recently aired first: per-source summary (pctIn + ranked candidates),
	// last air read, alert count.
	// Every air read still retained (the store keeps 30 min), newest first.
	app.get<{ Querystring: { limit?: string } }>('/api/air-reads', (req) => {
		const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
		return {
			reads: config.store
				.getRaceKeys()
				.flatMap((raceKey) => config.store.getAirHistory(raceKey))
				.sort((left, right) => right.observedAt - left.observedAt)
				.slice(0, limit)
				.map(serializeObservation),
		};
	});

	app.get('/api/races', () => {
		const store = config.store;
		const now = Date.now();
		return {
			races: store
				.getRaceKeys()
				.map((raceKey) => {
					const sources = Object.fromEntries(
						SOURCES.map((source) => [
							source,
							summarizeSource(latest(historyFor(store, source, raceKey))),
						]),
					) as Record<SourceName, RaceSourceSummary>;
					// Only an on-air read moves a race: the operator is watching what's on screen,
					// and DDHQ/Ross re-record every tracked race each poll anyway.
					const lastAiredAt = latest(historyFor(store, 'air', raceKey))?.observedAt ?? null;
					const alertCount = config.reconcileRace?.(raceKey, now).length ?? 0;
					const canonical = config.raceIdentity
						?.getSnapshot()
						.canonicalRaces.find((race) => race.canonicalRaceKey === raceKey);
					const pendingLinkCount =
						config.raceIdentity
							?.getSnapshot()
							.proposals.filter(
								(proposal) =>
									proposal.status === 'pending' && proposal.candidateCanonicalRaceKey === raceKey,
							).length ?? 0;
					return {
						alertCount,
						lastAt: lastAiredAt,
						pendingLinkCount,
						provisional: canonical?.provisional ?? false,
						raceKey,
						sources,
					};
				})
				.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.raceKey.localeCompare(b.raceKey)),
		};
	});

	app.get(
		'/api/race-links',
		() => config.raceIdentity?.getSnapshot() ?? { aliases: [], canonicalRaces: [], proposals: [] },
	);

	app.post<{ Params: { id: string } }>('/api/race-links/proposals/:id/accept', (req, reply) => {
		if (config.raceIdentity === undefined)
			return reply.code(503).send({ error: 'race identity not wired' });
		const alias = config.raceIdentity.acceptProposal(decodeURIComponent(req.params.id));
		if (alias === undefined) return reply.code(404).send({ error: 'proposal not found' });
		config.onRaceRelink?.(alias.source, alias.sourceRaceKey, alias.canonicalRaceKey);
		changeBus?.broadcast({ type: 'changed' });
		return { alias, raceLinks: config.raceIdentity.getSnapshot() };
	});

	app.post<{ Params: { id: string } }>('/api/race-links/proposals/:id/reject', (req, reply) => {
		if (config.raceIdentity === undefined)
			return reply.code(503).send({ error: 'race identity not wired' });
		const proposal = config.raceIdentity.rejectProposal(decodeURIComponent(req.params.id));
		if (proposal === undefined) return reply.code(404).send({ error: 'proposal not found' });
		changeBus?.broadcast({ type: 'changed' });
		return { proposal, raceLinks: config.raceIdentity.getSnapshot() };
	});

	app.post<{ Body: { canonicalRaceKey?: unknown; source?: unknown; sourceRaceKey?: unknown } }>(
		'/api/race-links/aliases',
		(req, reply) => {
			if (config.raceIdentity === undefined)
				return reply.code(503).send({ error: 'race identity not wired' });
			const { canonicalRaceKey, source, sourceRaceKey } = req.body;
			if (!SOURCES.includes(source as SourceName))
				return reply.code(400).send({ error: 'source is invalid' });
			if (typeof sourceRaceKey !== 'string' || sourceRaceKey.length === 0)
				return reply.code(400).send({ error: 'sourceRaceKey must be a non-empty string' });
			if (typeof canonicalRaceKey !== 'string' || canonicalRaceKey.length === 0)
				return reply.code(400).send({ error: 'canonicalRaceKey must be a non-empty string' });
			const alias = config.raceIdentity.manualRelink(
				source as SourceName,
				sourceRaceKey,
				canonicalRaceKey,
			);
			if (alias === undefined) return reply.code(404).send({ error: 'canonical race not found' });
			config.onRaceRelink?.(alias.source, alias.sourceRaceKey, alias.canonicalRaceKey);
			return { alias, raceLinks: config.raceIdentity.getSnapshot() };
		},
	);

	// Per-race comparison: latest observation per source, candidates aligned across
	// sources by normalized name, plus that race's current anomalies.
	app.get<{ Params: { raceKey: string } }>('/api/race/:raceKey', (req) => {
		const store = config.store;
		const raceKey = decodeURIComponent(req.params.raceKey);
		const perSource = SOURCES.map((source) => ({
			observation: latest(historyFor(store, source, raceKey)),
			source,
		}));

		// Union of candidates across sources, keyed by normalized name.
		const rows = new Map<
			string,
			{
				cells: Partial<Record<SourceName, { called: boolean; pct: number; votes: number }>>;
				name: string;
			}
		>();
		perSource.forEach(({ observation, source }) => {
			observation?.candidates.forEach((candidate) => {
				const id = normalizeName(candidate.name);
				const row = rows.get(id) ?? { cells: {}, name: candidate.name };
				const called = (observation.calledFor ?? []).some(
					(key) => key === candidate.key || normalizeName(key) === id,
				);
				row.cells[source] = { called, pct: candidate.pct, votes: candidate.votes };
				rows.set(id, row);
			});
		});

		return {
			anomalies: config.reconcileRace?.(raceKey, Date.now()) ?? [],
			candidates: Array.from(rows.values()),
			// Every retained observation of the race from all three sources, newest first.
			observations: SOURCES.flatMap((source) => historyFor(store, source, raceKey))
				.sort((left, right) => right.observedAt - left.observedAt)
				.map(serializeObservation),
			raceKey,
			sources: perSource.map(({ observation, source }) => ({
				aliasMethod: aliasFor(config.raceIdentity, observation)?.method ?? null,
				canonicalRaceKey: aliasFor(config.raceIdentity, observation)?.canonicalRaceKey ?? null,
				observedAt: observation?.observedAt ?? null,
				pctIn: observation?.pctIn ?? null,
				present: observation !== undefined,
				reportedAt: observation?.reportedAt ?? null,
				source,
				sourceRaceKey: observation?.sourceRaceKey ?? observation?.raceKey ?? null,
			})),
		};
	});

	app.get<{ Querystring: { limit?: string } }>('/api/alert-history', (req) => {
		const parsed = Number(req.query.limit);
		const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 1000) : 100;
		return { events: config.getAlertHistory?.(limit) ?? [] };
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
