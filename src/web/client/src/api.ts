// Typed fetch wrappers + shared response shapes for the Eagle Eye JSON API. These
// mirror src/web/server.ts; kept narrow to what the UI renders.

export type SourceName = 'air' | 'DDHQ' | 'Ross';

// Display label for a source. The internal discriminant stays 'air' (it's the
// on-air source in the reconciler/store/types); the UI shows 'Air'.
export const sourceLabel = (source: SourceName): string => (source === 'air' ? 'Air' : source);

export interface AlertEvent {
	detail: string;
	kind: 'cleared' | 'raised';
	owner: string;
	raceKey: string;
	severity: 'high' | 'low' | 'medium';
	subject?: string;
	ts: number;
	type: string;
}

export interface Anomaly {
	detail: string;
	observedAt: number;
	raceKey: string;
	severity: 'high' | 'low' | 'medium';
	subject?: string;
	type: string;
}

export interface ApiRecordingDetail {
	ddhqQueries: string[];
	name: string;
	sources: { errors: number; responses: number; source: ApiSource }[];
	startedAt: number;
	stoppedAt: null | number;
}

// Raw DDHQ + Chameleon response recording (Record button) / playback (Play button).
export type ApiRecordingStatus =
	| {
			durationMs: number;
			elapsedMs: number;
			ended: boolean;
			mode: 'playback';
			name: string;
			paused: boolean;
			speed: number;
	  }
	| { mode: 'live'; recording: { name: string; responseCount: number; startedAt: number } | null };

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

export interface Cadence {
	intervalMs: number;
	mode: 'interval' | 'manual';
}

export interface Candidate {
	key: string;
	name: string;
	party: string;
	pct: number;
	votes: number;
}

export interface CanonicalRace {
	canonicalRaceKey: string;
	descriptor: RaceDescriptor;
	provisional: boolean;
}

export type DdhqEnvironment = 'integration' | 'production';

export interface DiskUsage {
	freeBytes: number;
	totalBytes: number;
}

export interface Observation {
	calledFor: string[];
	candidates: Candidate[];
	observedAt: number;
	pctIn: number;
	raceKey: string;
	reportedAt: null | number;
	source: SourceName;
	sourceRaceKey?: string;
	templateId?: string;
}

export interface RaceAlias {
	canonicalRaceKey: string;
	method: string;
	source: SourceName;
	sourceRaceKey: string;
	updatedAt: number;
}

export interface RaceCell {
	called: boolean;
	pct: number;
	votes: number;
}

export interface RaceDescriptor {
	candidateNames: string[];
	heading: null | string;
	normalizedKey: string;
	source: SourceName;
	sourceRaceKey: string;
}

export interface RaceDetailResponse {
	anomalies: Anomaly[];
	candidates: { cells: Partial<Record<SourceName, RaceCell>>; name: string }[];
	raceKey: string;
	sources: {
		aliasMethod: null | string;
		canonicalRaceKey: null | string;
		observedAt: null | number;
		pctIn: null | number;
		present: boolean;
		reportedAt: null | number;
		source: SourceName;
		sourceRaceKey: null | string;
	}[];
}

export interface RaceLinkProposal {
	candidateCanonicalRaceKey: null | string;
	id: string;
	incoming: RaceDescriptor;
	reason: string;
	source: SourceName;
	sourceRaceKey: string;
	status: 'accepted' | 'pending' | 'rejected';
}

export interface RaceLinksResponse {
	aliases: RaceAlias[];
	canonicalRaces: CanonicalRace[];
	proposals: RaceLinkProposal[];
}

export interface RaceSourceCandidate {
	called: boolean;
	name: string;
	party: string;
	pct: number;
	votes: number;
}

export interface RaceSourceSummary {
	candidates: RaceSourceCandidate[];
	pctIn: null | number;
	present: boolean;
}

export interface RaceSummary {
	alertCount: number;
	lastAt: null | number;
	pendingLinkCount: number;
	provisional: boolean;
	raceKey: string;
	sources: Record<SourceName, RaceSourceSummary>;
}

export type SessionStatus = { id: null | string; running: boolean; startedAt: null | number };

export interface SessionSummary {
	alerts: number;
	current: boolean;
	endedAt: null | number;
	frames: number;
	framesBytes: number;
	id: string;
	observations: number;
	sqliteBytes: number;
	startedAt: null | number;
}

export interface SourceStat {
	error: { count: number; message: string; since: number } | null; // current poll/capture failure
	lastAt: null | number;
	observations: number;
	races: number;
	source: SourceName;
}

export interface StateResponse {
	airMatch: null | string;
	alerts: Anomaly[];
	cadence: Cadence | null;
	ddhqEnvironment: DdhqEnvironment | null; // null: DDHQ not configured, or API playback
	lastFrame: { observations: Observation[]; ts: number } | null;
	pendingLinkCount: number;
	session: null | SessionStatus;
	sources: SourceStat[];
}

const apiRecordingUrl = (name: string): string => `/api/api-recordings/${encodeURIComponent(name)}`;

// A plain URL, so the raw stored JSON also opens in a new tab.
export const apiResponseBodyUrl = (name: string, seq: number): string =>
	`${apiRecordingUrl(name)}/responses/${seq}/body`;

const getJson = async <T>(url: string): Promise<T> => {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json() as Promise<T>;
};

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
	const res = await fetch(url, {
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
	});
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json() as Promise<T>;
};

export const api = {
	acceptRaceProposal: (id: string) =>
		postJson<{ raceLinks: RaceLinksResponse }>(
			`/api/race-links/proposals/${encodeURIComponent(id)}/accept`,
			{},
		),
	// Reads the body even on a 500 so the real capture error reaches the UI.
	capture: async (): Promise<{ error?: string; ran: boolean; status: string }> => {
		const res = await fetch('/api/capture', { method: 'POST' });
		return res.json() as Promise<{ error?: string; ran: boolean; status: string }>;
	},
	deleteApiRecording: async (name: string): Promise<{ freedBytes: number }> => {
		const url = apiRecordingUrl(name);
		const res = await fetch(url, { method: 'DELETE' });
		if (!res.ok) throw new Error(`${res.status} ${url}`);
		return res.json() as Promise<{ freedBytes: number }>;
	},
	deleteSession: async (id: string): Promise<{ freedBytes: number }> => {
		const url = `/api/sessions/${encodeURIComponent(id)}`;
		const res = await fetch(url, { method: 'DELETE' });
		if (!res.ok) throw new Error(`${res.status} ${url}`);
		return res.json() as Promise<{ freedBytes: number }>;
	},
	getAlertHistory: (limit = 100) =>
		getJson<{ events: AlertEvent[] }>(`/api/alert-history?limit=${limit}`),
	getApiRecording: () => getJson<ApiRecordingStatus>('/api/api-recording'),
	getApiRecordingMeta: (name: string) => getJson<ApiRecordingDetail>(apiRecordingUrl(name)),
	getApiResponseBody: async (name: string, seq: number): Promise<string> => {
		const url = apiResponseBodyUrl(name, seq);
		const res = await fetch(url);
		if (!res.ok) throw new Error(`${res.status} ${url}`);
		return res.text();
	},
	getQueries: () => getJson<{ queries: string[] }>('/api/queries'),
	getRace: (raceKey: string) =>
		getJson<RaceDetailResponse>(`/api/race/${encodeURIComponent(raceKey)}`),
	getRaceLinks: () => getJson<RaceLinksResponse>('/api/race-links'),
	getRaces: () => getJson<{ races: RaceSummary[] }>('/api/races'),
	getSessions: () => getJson<{ disk: DiskUsage; sessions: SessionSummary[] }>('/api/sessions'),
	getState: () => getJson<StateResponse>('/api/state'),
	getTestVideos: () => getJson<{ files: string[] }>('/api/test-videos'),
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
	openTestVideo: async (file: string): Promise<void> => {
		const res = await fetch('/api/test-video', {
			body: JSON.stringify({ file }),
			headers: { 'content-type': 'application/json' },
			method: 'POST',
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error ?? `${res.status} /api/test-video`);
		}
	},
	// Surfaces the server's message: the usual failure is the debug Chrome not running.
	// pause | resume | restart | stop; stop goes back to the live APIs.
	playbackAction: (action: 'pause' | 'restart' | 'resume' | 'stop') =>
		postJson<ApiRecordingStatus>(`/api/api-playback/${action}`, {}),
	pruneSessionFrames: (id: string) =>
		postJson<{ freedBytes: number }>(`/api/sessions/${encodeURIComponent(id)}/prune-frames`, {}),
	rejectRaceProposal: (id: string) =>
		postJson<{ raceLinks: RaceLinksResponse }>(
			`/api/race-links/proposals/${encodeURIComponent(id)}/reject`,
			{},
		),
	setAirMatch: (match: string) => postJson<{ match: string }>('/api/air-match', { match }),
	setCadence: (next: Partial<Cadence>) => postJson<Cadence>('/api/cadence', next),
	setDdhqEnvironment: (environment: DdhqEnvironment) =>
		postJson<{ environment: DdhqEnvironment }>('/api/ddhq-environment', { environment }),
	setQueries: (queries: string[]) => postJson<{ queries: string[] }>('/api/queries', { queries }),
	setRaceAlias: (body: { canonicalRaceKey: string; source: SourceName; sourceRaceKey: string }) =>
		postJson<{ raceLinks: RaceLinksResponse }>('/api/race-links/aliases', body),
	startApiPlayback: (name: string, speed: number) =>
		postJson<ApiRecordingStatus>('/api/api-playback/start', { name, speed }),
	startApiRecording: (name?: string) =>
		postJson<ApiRecordingStatus>('/api/api-recording/start', name === undefined ? {} : { name }),
	startSession: () => postJson<SessionStatus>('/api/session/start', {}),
	stopApiRecording: () => postJson<ApiRecordingStatus>('/api/api-recording/stop', {}),
	stopSession: () => postJson<SessionStatus>('/api/session/stop', {}),
};

// Preset tabs the capture button can target (label → URL substring).
// The TEST source's match is the player page's path (TEST_PLAYER_PATH on the server).
export const TEST_AIR_MATCH = '/test-player/';

export const AIR_PRESETS: { label: string; match: string }[] = [
	{ label: 'DirecTV', match: 'directv' },
	{ label: 'TEST', match: TEST_AIR_MATCH },
];
