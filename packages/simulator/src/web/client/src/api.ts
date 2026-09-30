// Typed fetch wrappers + shared response shapes for the simulator's control API. These
// mirror src/web/server.ts; kept narrow to what the UI renders.

// How a night paces its graphics; see AirSchedule in src/settings.ts.
export interface AirSchedule {
	fsCount: number;
	gapSeconds: number;
	l3Count: number;
	overlaySeconds: number;
	tickerSeconds: number;
}

export type AirSource = 'ddhqIntegration' | 'invented';

export interface AirStatus {
	called: number;
	durationMs: number;
	elapsedMs: number;
	faultRate: number; // the share of airings, 0 to 1, that put something wrong on air
	next: null | OverlayStatus; // the next overlay to come up; null when the mix has none
	overlay: null | OverlayStatus; // the overlay up now
	races: number;
	recording: null | string; // the API recording on air, when playback is what's on air
	schedule: AirSchedule;
	seed: number;
	ticker: string; // the race on the ticker now
}

export interface ApiRecordingDetail {
	ddhqQueries: string[];
	name: string;
	sources: { errors: number; responses: number; source: ApiSource }[];
	startedAt: number;
	stoppedAt: null | number;
}

export interface ApiRecordingSummary {
	file: string;
	name: string;
	responseCount: number;
	startedAt: number;
	stoppedAt: null | number;
}

export interface ApiResponseQuery {
	before?: number;
	errorsOnly?: boolean;
	limit?: number;
	source?: ApiSource;
}

export interface ApiResponseSummary {
	bytes: number; // stored JSON size; 0 when the call failed
	error: null | string;
	path: string;
	seq: number;
	source: ApiSource;
	ts: number;
}

export type ApiSource = 'DDHQ' | 'Ross';

// atMs: when it comes up (next) or goes down (overlay), in epoch ms.
export interface OverlayStatus {
	atMs: number;
	kind: 'fs' | 'l3';
	race: string;
}

export interface PlaybackStatus {
	ddhqQueries: string[];
	durationMs: number;
	elapsedMs: number;
	ended: boolean;
	name: string;
	paused: boolean;
	startTs: number; // recording time at elapsed 0
}

export interface Settings {
	airSchedule: AirSchedule;
	airSource: AirSource;
	intervalSeconds: number;
	queries: string[];
}

export interface Status {
	air: AirStatus | null;
	checkerWatching: boolean; // the checker asked the mirror in the last 15 s; seeking waits for it to stop
	liveResultErrors: string[]; // the live-results poll's last check, while a ddhqIntegration night runs
	playback: null | PlaybackStatus;
	recordErrors: string[]; // the record loop's last check, while recording
	recording: { name: string; responseCount: number; startedAt: number } | null;
	recordIntervalSeconds: number;
}

const apiRecordingUrl = (name: string): string => `/api/api-recordings/${encodeURIComponent(name)}`;

// A plain URL, so the raw stored JSON also opens in a new tab.
export const apiResponseBodyUrl = (name: string, seq: number): string =>
	`${apiRecordingUrl(name)}/responses/${seq}/body`;

// Surfaces the server's { error } message when there is one.
const failed = async (res: Response, url: string): Promise<Error> => {
	const body = (await res.json().catch(() => ({}))) as { error?: string };
	return new Error(body.error ?? `${res.status} ${url}`);
};

const getJson = async <T>(url: string): Promise<T> => {
	const res = await fetch(url);
	if (!res.ok) throw await failed(res, url);
	return res.json() as Promise<T>;
};

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
	const res = await fetch(url, {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
	if (!res.ok) throw await failed(res, url);
	return res.json() as Promise<T>;
};

export const api = {
	deleteApiRecording: async (name: string): Promise<{ freedBytes: number }> => {
		const url = apiRecordingUrl(name);
		const res = await fetch(url, { method: 'DELETE' });
		if (!res.ok) throw await failed(res, url);
		return res.json() as Promise<{ freedBytes: number }>;
	},
	getApiRecordingMeta: (name: string) => getJson<ApiRecordingDetail>(apiRecordingUrl(name)),
	getApiResponseBody: async (name: string, seq: number): Promise<string> => {
		const url = apiResponseBodyUrl(name, seq);
		const res = await fetch(url);
		if (!res.ok) throw await failed(res, url);
		return res.text();
	},
	getSettings: () => getJson<Settings>('/api/settings'),
	getStatus: () => getJson<Status>('/api/status'),
	listApiRecordings: () => getJson<{ recordings: ApiRecordingSummary[] }>('/api/api-recordings'),
	listApiResponses: (name: string, query: ApiResponseQuery) => {
		const params = new URLSearchParams();
		if (query.before !== undefined) params.set('before', String(query.before));
		if (query.errorsOnly === true) params.set('errors', '1');
		if (query.limit !== undefined) params.set('limit', String(query.limit));
		if (query.source !== undefined) params.set('source', query.source);
		return getJson<{ responses: ApiResponseSummary[] }>(
			`${apiRecordingUrl(name)}/responses?${params.toString()}`,
		);
	},
	playbackAction: (action: 'pause' | 'restart' | 'resume' | 'stop') =>
		postJson<Status>(`/api/api-playback/${action}`, {}),
	seekApiPlayback: (elapsedMs: number) => postJson<Status>('/api/api-playback/seek', { elapsedMs }),
	setSettings: (settings: Settings) => postJson<Settings>('/api/settings', settings),
	startAir: (durationMinutes: number, faultPercent: number) =>
		postJson<Status>('/api/air/start', { durationMinutes, faultPercent }),
	startApiPlayback: (name: string) => postJson<Status>('/api/api-playback/start', { name }),
	startApiRecording: (name?: string) =>
		postJson<Status>('/api/api-recording/start', name === undefined ? {} : { name }),
	stopAir: () => postJson<Status>('/api/air/stop', {}),
	stopApiRecording: () => postJson<Status>('/api/api-recording/stop', {}),
};
