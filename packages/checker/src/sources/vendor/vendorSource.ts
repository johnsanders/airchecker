import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { HttpJson } from '../http.js';
import type { Mode } from '../provider/providerSource.js';
import type { VendorPoller } from './poller.js';

import { makeFetchHttp } from '../http.js';
import { simBaseUrl } from '../provider/providerSource.js';
import { makeVendorPoller } from './poller.js';

// Assembles the live Chameleon vendor source. The playlist endpoint is the fixed,
// known network Chameleon blade — hardcoded (VPN-only). In Sim mode the simulator's
// mirror serves the same path.
const CHAMELEON_HOST = 'http://txdaldc1nnr001.nexstar.tv';
const CHAMELEON_PATH =
	'/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json&pretty=yes&dynFieldDefaultAttr=false';
// A graphic is drawn from Ross's state some seconds before it's read off air, and is held
// against what we saw Ross say. Polled any slower than that state takes to reach air, air
// would show figures we hadn't seen yet, and a correct graphic would read as a mismatch.
const POLL_INTERVAL_MS = 5_000;

export type VendorSource = {
	intervalMs: number;
	poller: VendorPoller;
};

export type VendorSourceOptions = {
	getMode?: () => Mode; // default live
	http?: HttpJson;
};

export const makeVendorSource = (
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown,
	options: VendorSourceOptions = {},
): VendorSource => {
	const getUrl = (): string =>
		`${options.getMode?.() === 'sim' ? simBaseUrl() : CHAMELEON_HOST}${CHAMELEON_PATH}`;
	const poller = makeVendorPoller({
		getUrl,
		http: options.http ?? makeFetchHttp(),
		onObservations,
	});
	return { intervalMs: POLL_INTERVAL_MS, poller };
};
