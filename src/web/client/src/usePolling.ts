import React from 'react';

// setInterval-based polling (the nn-toolbox pattern: useEffect + setInterval +
// cleanup). Fetches once immediately, then every intervalMs. Re-runs when `deps`
// change (e.g. the selected race). Errors are captured, not thrown.
export const usePolling = <T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  deps: React.DependencyList = [],
): { data: T | undefined; error: string | undefined } => {
  const [data, setData] = React.useState<T | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const next = await fetcher();
        if (!cancelled) {
          setData(next);
          setError(undefined);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error };
};

// Human "Ns ago" from an epoch-ms timestamp.
export const ago = (ts: number | null | undefined): string => {
  if (ts === null || ts === undefined) return '—';
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
};
