import type { FastifyInstance, FastifyReply } from 'fastify';

import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AirShow } from '../air/airShow.js';
import type { ApiPlayback, MirrorAnswer } from '../playback/apiPlayback.js';
import type { ApiRecorder } from '../recording/apiRecorder.js';
import type { ApiResponseQuery, ApiSource } from '../recording/apiRecording.js';
import type { AirSource, DdhqEnvironment, SettingsStore } from '../settings.js';

import { MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS } from '../settings.js';

// Two faces on one port. The control API (/api/settings, /api/status,
// /api/api-recording*, /api/api-playback/*) drives the web view. The mirror
// (/api/v4/*, /chameleon/*) answers the same paths as DDHQ and the Chameleon blade,
// from the recording playing back, so airchecker's Sim environment only swaps hosts.
// /air/ is the simulated air feed, the page the checker's capturer points at instead of
// DirecTV; /api/air/* runs its night.

export type WebServerConfig = {
	airShow: AirShow;
	playback: ApiPlayback;
	recorder: ApiRecorder;
	recordErrors: () => string[];
	settings: SettingsStore;
};

const AIR_SOURCES: readonly AirSource[] = ['ddhqIntegration', 'invented'];
const API_SOURCES: readonly ApiSource[] = ['DDHQ', 'Ross'];
const ENVIRONMENTS: readonly DdhqEnvironment[] = ['integration', 'production'];
const RESPONSES_PAGE = 200;
const RESPONSES_PAGE_MAX = 1000;
const WHOLE_NUMBER = /^\d+$/;

const clientDistDir = (): string => join(dirname(fileURLToPath(import.meta.url)), 'client', 'dist');

const packageDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The air page, its graphics and what they load. The rest of the package dir (settings,
// recordings) stays off the web.
const AIR_FILES = new Set(['/', '/air.html', '/fullscreen.html', '/l3.html', '/ticker.html']);
const AIR_DIRS = ['/fonts/', '/fullscreen-assets/', '/l3-assets/'];

const MAX_AIR_MINUTES = 600;

const failure = (error: unknown): { error: string } => ({
	error: error instanceof Error ? error.message : String(error),
});

// Status codes the pollers' error handling already reads: a recorded failure comes back
// as a failure with its original message, so airchecker sees what it would have seen.
const sendAnswer = (reply: FastifyReply, answer: MirrorAnswer): FastifyReply => {
	if (answer.kind === 'ok') return reply.send(answer.body);
	if (answer.kind === 'idle') return reply.code(503).type('text/plain').send('no playback running');
	return reply
		.code(answer.kind === 'miss' ? 404 : 502)
		.type('text/plain')
		.send(answer.message);
};

export const makeWebServer = (config: WebServerConfig): FastifyInstance => {
	const app = Fastify({ logger: false });

	// --- Mirror ---------------------------------------------------------------

	app.post('/api/v4/oauth/token', () => ({
		access_token: 'elex-sim',
		expires_in: 86_400,
		token_type: 'Bearer',
	}));
	// A running simulated night serves the mirror; otherwise the recording playing back does.
	const answer = (source: ApiSource, path: string): MirrorAnswer =>
		config.airShow.mirror(source, path) ?? config.playback.answer(source, path);
	app.get('/api/v4/*', (req, reply) => sendAnswer(reply, answer('DDHQ', req.url)));
	app.get('/chameleon/*', (req, reply) => sendAnswer(reply, answer('Ross', req.url)));

	// What the checker's Sim mode should poll DDHQ for: the night's races, or the queries
	// the playing recording was made with.
	app.get('/api/sim/queries', () => ({
		queries: config.airShow.queries() ?? config.playback.status()?.ddhqQueries ?? [],
	}));

	// --- Control --------------------------------------------------------------

	app.get('/api/settings', () => config.settings.get());

	app.post<{
		Body: {
			airSource?: unknown;
			environment?: unknown;
			intervalSeconds?: unknown;
			queries?: unknown;
		} | null;
	}>('/api/settings', (req, reply) => {
		const airSource = req.body?.airSource;
		const environment = req.body?.environment;
		const intervalSeconds = req.body?.intervalSeconds;
		const queries = req.body?.queries;
		if (!AIR_SOURCES.includes(airSource as AirSource))
			return reply.code(400).send({ error: 'airSource must be invented or ddhqIntegration' });
		if (!ENVIRONMENTS.includes(environment as DdhqEnvironment))
			return reply.code(400).send({ error: 'environment must be production or integration' });
		if (
			typeof intervalSeconds !== 'number' ||
			!Number.isInteger(intervalSeconds) ||
			intervalSeconds < MIN_INTERVAL_SECONDS ||
			intervalSeconds > MAX_INTERVAL_SECONDS
		)
			return reply.code(400).send({
				error: `intervalSeconds must be a whole number from ${MIN_INTERVAL_SECONDS} to ${MAX_INTERVAL_SECONDS}`,
			});
		if (!Array.isArray(queries) || !queries.every((query) => typeof query === 'string'))
			return reply.code(400).send({ error: 'queries must be an array of strings' });
		return config.settings.set({
			airSource: airSource as AirSource,
			environment: environment as DdhqEnvironment,
			intervalSeconds,
			queries: queries.map((query) => query.trim()).filter((query) => query.length > 0),
		});
	});

	const status = () => ({
		air: config.airShow.status(),
		liveResultErrors: config.airShow.liveResultErrors(),
		playback: config.playback.status() ?? null,
		recordErrors: config.recorder.status().recording === null ? [] : config.recordErrors(),
		recording: config.recorder.status().recording,
		recordIntervalSeconds: config.settings.get().intervalSeconds,
	});

	app.get('/api/status', status);

	app.get('/api/api-recordings', () => ({ recordings: config.recorder.list() }));

	app.get<{ Params: { name: string } }>('/api/api-recordings/:name', (req, reply) => {
		const meta = config.recorder.meta(req.params.name);
		if (meta === undefined) return reply.code(404).send({ error: 'no such API recording' });
		return meta;
	});

	// Newest first, without bodies; page back with before=<last seq>.
	app.get<{
		Params: { name: string };
		Querystring: { before?: string; errors?: string; limit?: string; source?: string };
	}>('/api/api-recordings/:name/responses', (req, reply) => {
		const source = req.query.source;
		if (source !== undefined && !API_SOURCES.includes(source as ApiSource))
			return reply.code(400).send({ error: 'source must be DDHQ or Ross' });
		if (req.query.before !== undefined && !WHOLE_NUMBER.test(req.query.before))
			return reply.code(400).send({ error: 'before must be a whole number' });
		if (req.query.limit !== undefined && !WHOLE_NUMBER.test(req.query.limit))
			return reply.code(400).send({ error: 'limit must be a whole number' });
		const query: ApiResponseQuery = {
			errorsOnly: req.query.errors === '1',
			limit: Math.min(Number(req.query.limit ?? RESPONSES_PAGE), RESPONSES_PAGE_MAX),
			...(req.query.before === undefined ? {} : { beforeSeq: Number(req.query.before) }),
			...(source === undefined ? {} : { source: source as ApiSource }),
		};
		const responses = config.recorder.responses(req.params.name, query);
		if (responses === undefined) return reply.code(404).send({ error: 'no such API recording' });
		return { responses };
	});

	// The stored JSON text, sent as is (a Chameleon body is ~350 KB; no re-serializing).
	app.get<{ Params: { name: string; seq: string } }>(
		'/api/api-recordings/:name/responses/:seq/body',
		(req, reply) => {
			if (!WHOLE_NUMBER.test(req.params.seq))
				return reply.code(400).send({ error: 'seq must be a whole number' });
			const body = config.recorder.body(req.params.name, Number(req.params.seq));
			if (body === undefined) return reply.code(404).send({ error: 'no such API recording' });
			if (body === null) return reply.code(404).send({ error: 'no body for that response' });
			return reply.type('application/json').send(body);
		},
	);

	// A playing recording is refused too, though it's already in memory: deleting what's
	// on air would leave the banner naming a file that's gone.
	app.delete<{ Params: { name: string } }>('/api/api-recordings/:name', (req, reply) => {
		if (config.playback.status()?.name === req.params.name)
			return reply.code(409).send({ error: `${req.params.name} is playing back` });
		try {
			const freedBytes = config.recorder.remove(req.params.name);
			if (freedBytes === undefined) return reply.code(404).send({ error: 'no such API recording' });
			return { freedBytes };
		} catch (error) {
			return reply.code(409).send(failure(error));
		}
	});

	app.post<{ Body: { name?: unknown } | null }>('/api/api-recording/start', (req, reply) => {
		const name = typeof req.body?.name === 'string' ? req.body.name : undefined;
		try {
			config.recorder.start(name);
			return status();
		} catch (error) {
			return reply.code(409).send(failure(error));
		}
	});

	app.post('/api/api-recording/stop', () => {
		config.recorder.stop();
		return status();
	});

	app.post<{ Body: { name?: unknown } | null }>('/api/api-playback/start', (req, reply) => {
		const name = req.body?.name;
		if (typeof name !== 'string') return reply.code(400).send({ error: 'name is required' });
		try {
			config.playback.start(name);
			config.airShow.stop();
		} catch (error) {
			return reply.code(404).send(failure(error));
		}
		return status();
	});

	(['pause', 'resume', 'restart', 'stop'] as const).forEach((action) =>
		app.post(`/api/api-playback/${action}`, (_req, reply) => {
			if (config.playback.status() === undefined)
				return reply.code(409).send({ error: 'no API playback running' });
			config.playback[action]();
			return status();
		}),
	);

	// --- Air feed -------------------------------------------------------------

	app.get('/api/air/now', () => ({ onAir: config.airShow.onAir() }));

	// What was on air at a wall-clock time (epoch ms), in any night this process ran: the
	// ground truth for scoring the checker's reads of frames it captured from /air/.
	app.get<{ Querystring: { ts?: string } }>('/api/air/aired', (req, reply) => {
		if (req.query.ts === undefined || !WHOLE_NUMBER.test(req.query.ts))
			return reply.code(400).send({ error: 'ts must be a whole number of epoch ms' });
		return { onAir: config.airShow.airedAt(Number(req.query.ts)) };
	});

	app.post<{ Body: { durationMinutes?: unknown; faultPercent?: unknown } | null }>(
		'/api/air/start',
		(req, reply) => {
			const durationMinutes = req.body?.durationMinutes;
			// The share of airings that put something wrong on air; none unless asked for.
			const faultPercent = req.body?.faultPercent ?? 0;
			if (
				typeof durationMinutes !== 'number' ||
				!(durationMinutes > 0) ||
				durationMinutes > MAX_AIR_MINUTES
			)
				return reply
					.code(400)
					.send({ error: `durationMinutes must be more than 0 and at most ${MAX_AIR_MINUTES}` });
			if (typeof faultPercent !== 'number' || !(faultPercent >= 0) || faultPercent > 100)
				return reply.code(400).send({ error: 'faultPercent must be from 0 to 100' });
			// One thing serves the mirror at a time.
			if (config.playback.status() !== undefined) config.playback.stop();
			config.airShow.start(durationMinutes * 60_000, faultPercent / 100);
			return status();
		},
	);

	app.post('/api/air/stop', () => {
		config.airShow.stop();
		return status();
	});

	app.get('/air', (_req, reply) => reply.redirect('/air/'));
	void app.register(fastifyStatic, {
		allowedPath: (pathName) =>
			AIR_FILES.has(pathName) || AIR_DIRS.some((dir) => pathName.startsWith(dir)),
		decorateReply: false,
		index: 'air.html',
		prefix: '/air/',
		root: packageDir(),
	});
	// The newscast under the graphics; gitignored, so each machine supplies its own.
	void app.register(fastifyStatic, {
		decorateReply: false,
		prefix: '/air/video/',
		root: join(packageDir(), 'recordings', 'air'),
	});

	// --- Static SPA -----------------------------------------------------------

	const distDir = clientDistDir();
	if (existsSync(join(distDir, 'index.html'))) {
		void app.register(fastifyStatic, { root: distDir });
		app.setNotFoundHandler((req, reply) => {
			if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
			return reply.sendFile('index.html');
		});
	} else {
		app.get('/', (_req, reply) =>
			reply
				.type('text/html')
				.send(
					'<h1>Simulator</h1><p>Web UI not built. Run <code>npm run frontend:build</code>, then restart.</p>',
				),
		);
	}

	return app;
};
