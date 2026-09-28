import type { SourceName } from '../reconcile/reconcile.js';

import { errorMessage } from '../sources/http.js';

// Each source's current failure, for the log and the web view. A poll loop retries
// every few seconds, so logging every failure buries the log in identical lines:
// log once when a failure starts or its message changes, stay quiet while it repeats,
// and log once more when the source recovers.

export type SourceError = {
	count: number; // consecutive failed attempts
	message: string;
	since: number; // ms epoch of the first failure in this run
};

export type SourceErrors = {
	fail: (source: SourceName, error: unknown) => void;
	get: (source: SourceName) => SourceError | undefined;
	ok: (source: SourceName) => void;
};

const LOG_TAG: Record<SourceName, string> = { air: 'air', DDHQ: 'provider', Ross: 'vendor' };

export const makeSourceErrors = (
	config: { now?: () => number; onChange?: () => void } = {},
): SourceErrors => {
	const now = config.now ?? Date.now;
	const current = new Map<SourceName, SourceError>();

	return {
		fail: (source, error) => {
			const message = errorMessage(error);
			const previous = current.get(source);
			if (previous !== undefined && previous.message === message) {
				current.set(source, { ...previous, count: previous.count + 1 });
				return;
			}
			console.error(`[${LOG_TAG[source]}] failing: ${message}`);
			current.set(source, {
				count: (previous?.count ?? 0) + 1,
				message,
				since: previous?.since ?? now(),
			});
			config.onChange?.();
		},
		get: (source) => current.get(source),
		ok: (source) => {
			const previous = current.get(source);
			if (previous === undefined) return;
			console.log(`[${LOG_TAG[source]}] recovered after ${previous.count} failed attempt(s)`);
			current.delete(source);
			config.onChange?.();
		},
	};
};
