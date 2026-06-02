// Human "Ns ago" from an epoch-ms timestamp.
export const ago = (ts: null | number | undefined): string => {
	if (ts === null || ts === undefined) return '—';
	const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
	if (secs < 60) return `${secs}s ago`;
	if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
	return `${Math.floor(secs / 3600)}h ago`;
};
