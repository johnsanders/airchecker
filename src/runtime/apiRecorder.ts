import { existsSync, rmSync, statSync } from 'node:fs';

import type {
	ApiRecordingDetail,
	ApiRecordingSummary,
	ApiRecordingWriter,
	ApiResponseQuery,
	ApiResponseRow,
	ApiResponseSummary,
} from '../replay/apiRecording.js';
import type { ApiPlaybackStatus } from './apiPlayback.js';

import {
	listApiRecordings,
	listApiResponses,
	openApiRecordingWriter,
	readApiRecordingMeta,
	readApiResponseBody,
} from '../replay/apiRecording.js';

// The web view's Record button. `record` is handed to both sources' recording HTTP
// wrappers and drops rows unless a recording is active. meta/responses/body browse a
// recording by name (undefined when there's no such recording), finished or not.
// remove deletes one the same way, refusing the one being written.

export type ActiveApiRecording = {
	name: string;
	responseCount: number;
	startedAt: number;
};

export type ApiRecorder = {
	body: (name: string, seq: number) => null | string | undefined;
	list: () => ApiRecordingSummary[];
	meta: (name: string) => ApiRecordingDetail | undefined;
	record: (row: ApiResponseRow) => void;
	// Bytes freed; throws for the recording in progress.
	remove: (name: string) => number | undefined;
	responses: (name: string, query: ApiResponseQuery) => ApiResponseSummary[] | undefined;
	start: (name?: string) => ApiRecorderStatus;
	status: () => ApiRecorderStatus;
	stop: () => ApiRecorderStatus;
};

export type ApiRecorderConfig = {
	baseDir: string;
	getQueries: () => string[];
	now?: () => number;
	onStart?: () => void;
	onStop?: () => void;
};

export type ApiRecorderStatus =
	| { mode: 'live'; recording: ActiveApiRecording | null }
	| ({ mode: 'playback' } & ApiPlaybackStatus);

const defaultName = (at: number): string =>
	`api-${new Date(at).toISOString().replace(/[:.]/g, '-')}`;

// Names become file names; keep them to a safe charset.
const sanitizeName = (name: string): string =>
	name
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '');

export const makeApiRecorder = (config: ApiRecorderConfig): ApiRecorder => {
	const now = config.now ?? Date.now;
	let active:
		| { name: string; queriesAtStart: string[]; startedAt: number; writer: ApiRecordingWriter }
		| undefined;

	const status = (): ApiRecorderStatus => ({
		mode: 'live',
		recording:
			active === undefined
				? null
				: { name: active.name, responseCount: active.writer.count(), startedAt: active.startedAt },
	});

	// Names come from the web view; resolving them only through the listing means a
	// name can never reach outside the recordings directory.
	const withFile = <T>(name: string, read: (file: string) => T): T | undefined => {
		const file = listApiRecordings(config.baseDir).find((summary) => summary.name === name)?.file;
		return file === undefined ? undefined : read(file);
	};

	return {
		body: (name, seq) => withFile(name, (file) => readApiResponseBody(file, seq)),
		list: () => listApiRecordings(config.baseDir),
		meta: (name) => withFile(name, readApiRecordingMeta),
		record: (row) => active?.writer.append(row),
		remove: (name) => {
			if (active?.name === name) throw new Error(`${name} is still recording`);
			return withFile(name, (file) => {
				const files = ['', '-wal', '-shm'].map((suffix) => `${file}${suffix}`).filter(existsSync);
				const freed = files.reduce((total, path) => total + statSync(path).size, 0);
				files.forEach((path) => rmSync(path));
				console.log(`[api-record] deleted ${name}`);
				return freed;
			});
		},
		responses: (name, query) => withFile(name, (file) => listApiResponses(file, query)),
		start: (name) => {
			if (active !== undefined) throw new Error(`already recording ${active.name}`);
			const startedAt = now();
			const cleaned = sanitizeName(name ?? '');
			const resolvedName = cleaned.length > 0 ? cleaned : defaultName(startedAt);
			const queriesAtStart = config.getQueries();
			const writer = openApiRecordingWriter(config.baseDir, {
				ddhqQueries: queriesAtStart,
				name: resolvedName,
				startedAt,
			});
			active = { name: resolvedName, queriesAtStart, startedAt, writer };
			config.onStart?.();
			console.log(`[api-record] recording ${resolvedName} → ${writer.file}`);
			return status();
		},
		status,
		stop: () => {
			if (active === undefined) return status();
			const stopped = active;
			active = undefined;
			// Queries can be edited mid-recording; playback polls every one that was in use.
			stopped.writer.close(
				now(),
				Array.from(new Set([...stopped.queriesAtStart, ...config.getQueries()])),
			);
			config.onStop?.();
			console.log(`[api-record] stopped ${stopped.name} (${stopped.writer.count()} responses)`);
			return status();
		},
	};
};
