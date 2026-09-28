import type { RaceObservation } from '../../reconcile/reconcile.js';
import type { HttpJson } from '../http.js';
import type { DdhqEnvironment } from '../provider/providerSource.js';
import type { VendorPoller } from './poller.js';

import { makeFetchHttp } from '../http.js';
import { simBaseUrl } from '../provider/providerSource.js';
import { makeVendorPoller } from './poller.js';

// Assembles the live Chameleon vendor source. The playlist endpoint is the fixed,
// known network Chameleon blade — hardcoded, polled once a minute (VPN-only). In the
// Sim environment the simulator's mirror serves the same path.
const CHAMELEON_HOST = 'http://txdaldc1nnr001.nexstar.tv';
const CHAMELEON_PATH =
	'/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json&pretty=yes&dynFieldDefaultAttr=false';
const POLL_INTERVAL_MS = 60_000;

export type VendorSource = {
	intervalMs: number;
	poller: VendorPoller;
};

export type VendorSourceOptions = {
	getEnvironment?: () => DdhqEnvironment; // default production
	http?: HttpJson;
};

export const makeVendorSource = (
	onObservations: (observations: RaceObservation[]) => Promise<unknown> | unknown,
	options: VendorSourceOptions = {},
): VendorSource => {
	const getUrl = (): string =>
		`${options.getEnvironment?.() === 'sim' ? simBaseUrl() : CHAMELEON_HOST}${CHAMELEON_PATH}`;
	const poller = makeVendorPoller({
		getUrl,
		http: options.http ?? makeFetchHttp(),
		onObservations,
	});
	return { intervalMs: POLL_INTERVAL_MS, poller };
};
