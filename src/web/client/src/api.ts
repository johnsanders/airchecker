// Typed fetch wrappers + shared response shapes for the Eagle Eye JSON API. These
// mirror src/web/server.ts; kept narrow to what the UI renders.

export type SourceName = 'DDHQ' | 'Ross' | 'air';

export interface Candidate {
  key: string;
  name: string;
  party: string;
  pct: number;
  votes: number;
}

export interface Observation {
  calledFor: string[];
  candidates: Candidate[];
  observedAt: number;
  pctIn: number;
  raceKey: string;
  reportedAt: number | null;
  source: SourceName;
  templateId?: string;
}

export interface Anomaly {
  detail: string;
  observedAt: number;
  raceKey: string;
  severity: 'low' | 'medium' | 'high';
  type: string;
}

export interface SourceStat {
  lastAt: number | null;
  observations: number;
  races: number;
  source: SourceName;
}

export interface Cadence {
  intervalMs: number;
  mode: 'interval' | 'manual';
}

export interface StateResponse {
  alerts: Anomaly[];
  cadence: Cadence | null;
  lastFrame: { observations: Observation[]; ts: number } | null;
  sources: SourceStat[];
}

export interface RaceSummary {
  alertCount: number;
  lastAt: number | null;
  present: Record<SourceName, boolean>;
  raceKey: string;
}

export interface RaceCell {
  called: boolean;
  pct: number;
  votes: number;
}

export interface RaceDetailResponse {
  anomalies: Anomaly[];
  candidates: { cells: Partial<Record<SourceName, RaceCell>>; name: string }[];
  raceKey: string;
  sources: {
    observedAt: number | null;
    pctIn: number | null;
    present: boolean;
    reportedAt: number | null;
    source: SourceName;
  }[];
}

const getJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
};

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
};

export const api = {
  getState: () => getJson<StateResponse>('/api/state'),
  getRaces: () => getJson<{ races: RaceSummary[] }>('/api/races'),
  getRace: (raceKey: string) => getJson<RaceDetailResponse>(`/api/race/${encodeURIComponent(raceKey)}`),
  // Reads the body even on a 500 so the real capture error reaches the UI.
  capture: async (): Promise<{ error?: string; ran: boolean; status: string }> => {
    const res = await fetch('/api/capture', { method: 'POST' });
    return res.json() as Promise<{ error?: string; ran: boolean; status: string }>;
  },
  getQueries: () => getJson<{ queries: string[] }>('/api/queries'),
  setQueries: (queries: string[]) => postJson<{ queries: string[] }>('/api/queries', { queries }),
  setCadence: (next: Partial<Cadence>) => postJson<Cadence>('/api/cadence', next),
};
