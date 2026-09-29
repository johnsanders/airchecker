// Human "Ns ago" from an epoch-ms timestamp.
export const ago = (ts: null | number | undefined): string => {
	if (ts === null || ts === undefined) return '—';
	const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (secs < 60) return `${secs}s ago`;
	if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
	return `${Math.floor(secs / 3600)}h ago`;
};

// A percentage rounded to at most two decimals (trailing zeros trimmed): 92 → "92",
// 63.814 → "63.81". null/undefined → "—". Callers append the literal "%".
export const pct = (value: null | number | undefined): string =>
	value === null || value === undefined ? '—' : `${Math.round(value * 100) / 100}`;

const GRAPHIC_LABELS: Record<string, string> = {
	fullscreen_results: 'FS',
	lower_third: 'L3',
	ticker_v1: 'Ticker',
};

// Short name for the on-air template a read came from.
export const graphicLabel = (templateId: null | string | undefined): string =>
	GRAPHIC_LABELS[templateId ?? ''] ?? templateId ?? '—';

// 24-hour wall-clock time of an epoch-ms timestamp.
export const clockTime = (ts: number): string =>
	new Date(ts).toLocaleTimeString('en-US', { hour12: false });

export type Severity = 'high' | 'low' | 'medium';

export const SEVERITY_ORDER: Record<Severity, number> = { high: 0, low: 2, medium: 1 };

export const SEVERITY_COLOR: Record<Severity, 'default' | 'error' | 'warning'> = {
	high: 'error',
	low: 'default',
	medium: 'warning',
};
