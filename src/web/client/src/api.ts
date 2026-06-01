// Typed fetch wrappers + shared response shapes for the Eagle Eye JSON API. These
// mirror src/web/server.ts; kept narrow to what the UI renders.

export type SourceName = 'air' | 'DDHQ' | 'Ross';

// Display label for a source. The internal discriminant stays 'air' (it's the
// on-air source in the reconciler/store/types); the UI shows 'Actus' per request.
export const sourceLabel = (source: SourceName): string => (source === 'air' ? 'Actus' : source);

export interface Anomaly {
	detail: string;
	observedAt: number;
	raceKey: string;
	severity: 'high' | 'low' | 'medium';
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

export interface CanonicalRace {
	canonicalRaceKey: string;
	descriptor: RaceDescriptor;
	provisional: boolean;
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

export interface RaceSummary {
	alertCount: number;
	lastAt: null | number;
	pendingLinkCount: number;
	present: Record<SourceName, boolean>;
	provisional: boolean;
	raceKey: string;
}

export interface SourceStat {
	lastAt: null | number;
	observations: number;
	races: number;
	source: SourceName;
}

export interface StateResponse {
	alerts: Anomaly[];
	cadence: Cadence | null;
	lastFrame: { observations: Observation[]; ts: number } | null;
	pendingLinkCount: number;
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
	getAirMatch: () => getJson<{ match: null | string }>('/api/air-match'),
	getQueries: () => getJson<{ queries: string[] }>('/api/queries'),
	getRace: (raceKey: string) =>
		getJson<RaceDetailResponse>(`/api/race/${encodeURIComponent(raceKey)}`),
	getRaceLinks: () => getJson<RaceLinksResponse>('/api/race-links'),
	getRaces: () => getJson<{ races: RaceSummary[] }>('/api/races'),
	getState: () => getJson<StateResponse>('/api/state'),
	rejectRaceProposal: (id: string) =>
		postJson<{ raceLinks: RaceLinksResponse }>(
			`/api/race-links/proposals/${encodeURIComponent(id)}/reject`,
			{},
		),
	setAirMatch: (match: string) => postJson<{ match: string }>('/api/air-match', { match }),
	setCadence: (next: Partial<Cadence>) => postJson<Cadence>('/api/cadence', next),
	setQueries: (queries: string[]) => postJson<{ queries: string[] }>('/api/queries', { queries }),
	setRaceAlias: (body: { canonicalRaceKey: string; source: SourceName; sourceRaceKey: string }) =>
		postJson<{ raceLinks: RaceLinksResponse }>('/api/race-links/aliases', body),
};

// Preset tabs the capture button can target (label → URL substring).
export const AIR_PRESETS: { label: string; match: string }[] = [
	{ label: 'DirecTV', match: 'directv' },
	{ label: 'Actus', match: 'actus' },
];
