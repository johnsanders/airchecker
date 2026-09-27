import type {
	ApiRecordingSummary,
	ApiRecordingWriter,
	ApiResponseRow,
} from '../replay/apiRecording.js';

import { listApiRecordings, openApiRecordingWriter } from '../replay/apiRecording.js';

// The web view's Record button. `record` is handed to both sources' recording HTTP
// wrappers and drops rows unless a recording is active.

export type ActiveApiRecording = {
	name: string;
	responseCount: number;
	startedAt: number;
};

export type ApiRecorder = {
	list: () => ApiRecordingSummary[];
	record: (row: ApiResponseRow) => void;
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
	| {
			durationMs: number;
			elapsedMs: number;
			ended: boolean;
			mode: 'playback';
			name: string;
			speed: number;
	  }
	| { mode: 'live'; recording: ActiveApiRecording | null };

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

	return {
		list: () => listApiRecordings(config.baseDir),
		record: (row) => active?.writer.append(row),
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
