// Typed fetch wrappers + shared response shapes for the Eagle Eye JSON API. These
// mirror src/web/server.ts; kept narrow to what the UI renders.

export type SourceName = 'air' | 'DDHQ' | 'Ross';

// Display label for a source. The internal discriminant stays 'air' (it's the
// on-air source in the reconciler/store/types); the UI shows 'Air'.
export const sourceLabel = (source: SourceName): string => (source === 'air' ? 'Air' : source);

// One graphic read off air, as a record: what it showed, the Ross state it was held
// against, what DDHQ was saying, and what was found wrong. Nothing in it changes after
// the read.
export interface AirRead {
	airedAt: number;
	anomalies: { detail: string; severity: 'high' | 'low' | 'medium'; type: string }[];
	candidates: { cells: Partial<Record<SourceName, RaceCell>>; name: string; party: string }[];
	heading: string; // the race as the graphic printed it
	linked: boolean; // false: the heading fit no one known race, so there is nothing to compare
	pctIn: Record<SourceName, null | number>;
	pctInIsMinimum: boolean; // the graphic printed ">N% IN"
	raceKey: string;
	saidAt: Record<SourceName, null | number>; // when each source was first seen saying this
	templateId: null | string;
}

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

export type DdhqHost = 'integration' | 'production';

export interface DiskUsage {
	freeBytes: number;
	totalBytes: number;
}

// Live watches the real sources; Sim watches the simulator standing in for all three.
export type Mode = 'live' | 'sim';

export interface Observation {
	calledFor: string[];
	candidates: Candidate[];
	observedAt: number;
	pctIn: number;
	pctInIsMinimum?: boolean; // air: the graphic printed ">N% IN"
	raceKey: string;
	reportedAt: null | number;
	source: SourceName;
	sourceRaceKey?: string;
	templateId?: string;
}

export interface RaceCell {
	called: boolean;
	pct: number;
	votes: number;
}

export interface RaceDetailResponse {
	observations: Observation[]; // every retained observation, all sources, newest first
	raceKey: string;
	reads: AirRead[]; // every retained air read of the race, newest first
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
	lastAt: null | number; // when the source last answered
	observations: number;
	races: number;
	source: SourceName;
}

export interface StateResponse {
	airMatch: null | string;
	cadence: Cadence | null;
	ddhqHost: DdhqHost | null; // Live mode's DDHQ host; null: DDHQ not configured
	lastFrame: { observations: Observation[]; ts: number } | null;
	mode: Mode | null; // null: not switchable
	session: null | SessionStatus;
	sources: SourceStat[];
}

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
	// Reads the body even on a 500 so the real capture error reaches the UI.
	capture: async (): Promise<{ error?: string; ran: boolean; status: string }> => {
		const res = await fetch('/api/capture', { method: 'POST' });
		return res.json() as Promise<{ error?: string; ran: boolean; status: string }>;
	},
	deleteSession: async (id: string): Promise<{ freedBytes: number }> => {
		const url = `/api/sessions/${encodeURIComponent(id)}`;
		const res = await fetch(url, { method: 'DELETE' });
		if (!res.ok) throw new Error(`${res.status} ${url}`);
		return res.json() as Promise<{ freedBytes: number }>;
	},
	getAlertHistory: (limit = 100) =>
		getJson<{ events: AlertEvent[] }>(`/api/alert-history?limit=${limit}`),
	getQueries: () => getJson<{ queries: string[] }>('/api/queries'),
	getRace: (raceKey: string) =>
		getJson<RaceDetailResponse>(`/api/race/${encodeURIComponent(raceKey)}`),
	getRaces: () => getJson<{ races: AirRead[] }>('/api/races'),
	getSessions: () => getJson<{ disk: DiskUsage; sessions: SessionSummary[] }>('/api/sessions'),
	getState: () => getJson<StateResponse>('/api/state'),
	pruneSessionFrames: (id: string) =>
		postJson<{ freedBytes: number }>(`/api/sessions/${encodeURIComponent(id)}/prune-frames`, {}),
	setAirMatch: (match: string) => postJson<{ match: string }>('/api/air-match', { match }),
	setCadence: (next: Partial<Cadence>) => postJson<Cadence>('/api/cadence', next),
	setDdhqHost: (host: DdhqHost) => postJson<{ host: DdhqHost }>('/api/ddhq-host', { host }),
	setMode: (mode: Mode) => postJson<{ mode: Mode }>('/api/mode', { mode }),
	setQueries: (queries: string[]) => postJson<{ queries: string[] }>('/api/queries', { queries }),
	startSession: () => postJson<SessionStatus>('/api/session/start', {}),
	stopSession: () => postJson<SessionStatus>('/api/session/stop', {}),
};

// Preset tabs Live mode's capture can target (label → URL substring). Sim mode always
// captures the simulator's /air/ page.
export const AIR_PRESETS: { label: string; match: string }[] = [
	{ label: 'DirecTV', match: 'directv' },
];
