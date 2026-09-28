import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { HttpJson } from '../http.js';

import { adaptResponse } from './adapter.js';
import { chameleonResponseSchema } from './chameleonSchema.js';

// Polls the Chameleon vendor playlist endpoint (a single URL returning JSON for ALL
// contests, read each tick so an environment switch lands on the next poll). No auth — the URL is reachable only over the corporate VPN.
// Each tick: GET → parse → adapt every contest to a RaceObservation → onObservations.

export type VendorPoller = {
	pollOnce: () => Promise<void>;
};

export type VendorPollerConfig = {
	getUrl: () => string;
	http: HttpJson;
	now?: () => number; // observedAt clock; default Date.now
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown;
};

export const makeVendorPoller = (config: VendorPollerConfig): VendorPoller => {
	const now = config.now ?? Date.now;
	return {
		pollOnce: async () => {
			const observedAt = now();
			const raw: unknown = await config.http.getJson(config.getUrl());
			const parsed = chameleonResponseSchema.parse(raw);
			await config.onObservations(adaptResponse(parsed, observedAt));
		},
	};
};
