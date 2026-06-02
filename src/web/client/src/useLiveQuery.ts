import React from 'react';

import { subscribeToChanges } from './changeFeed.js';

// Refetches when the server pushes a "changed" nudge over the websocket (see
// changeFeed), not on a fixed timer — so the UI updates only when something actually
// changed. Same return shape as the old usePolling, so call sites barely change.
// A debounce coalesces a burst of nudges into one fetch; a long fallback interval
// self-heals a missed message or a silently-dead socket. Re-runs the initial fetch
// when `deps` change (e.g. the selected race).
const DEBOUNCE_MS = 150;
const FALLBACK_MS = 25_000;

export const useLiveQuery = <T>(
	fetcher: () => Promise<T>,
	deps: React.DependencyList = [],
): { data: T | undefined; error: string | undefined; reload: () => Promise<void> } => {
	const [data, setData] = React.useState<T | undefined>(undefined);
	const [error, setError] = React.useState<string | undefined>(undefined);
	const fetcherRef = React.useRef(fetcher);
	const mountedRef = React.useRef(true);
	fetcherRef.current = fetcher;

	React.useEffect(
		() => () => {
			mountedRef.current = false;
		},
		[],
	);

	const reload = React.useCallback(async (): Promise<void> => {
		try {
			const next = await fetcherRef.current();
			if (mountedRef.current) {
				setData(next);
				setError(undefined);
			}
		} catch (e) {
			if (mountedRef.current) setError(e instanceof Error ? e.message : String(e));
		}
	}, []);

	React.useEffect(() => {
		let debounce: ReturnType<typeof setTimeout> | undefined;
		const trigger = (): void => {
			if (debounce !== undefined) clearTimeout(debounce);
			debounce = setTimeout(() => void reload(), DEBOUNCE_MS);
		};
		void reload(); // initial fetch on mount / deps change
		const unsubscribe = subscribeToChanges(trigger);
		const fallback = setInterval(() => void reload(), FALLBACK_MS);
		return () => {
			if (debounce !== undefined) clearTimeout(debounce);
			clearInterval(fallback);
			unsubscribe();
		};
	}, deps);

	return { data, error, reload };
};
