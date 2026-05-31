import type { RaceObservation } from '../../reconcile/reconcile.js';
import { makeFetchHttp } from '../http.js';
import { makeVendorPoller } from './poller.js';
import type { VendorPoller } from './poller.js';

// Assembles the live Chameleon vendor source. The playlist endpoint is the fixed,
// known network Chameleon blade — hardcoded, polled once a minute (VPN-only).
const CHAMELEON_URL =
  'http://txdaldc1nnr001.nexstar.tv/chameleon/blade/election/playlist/128/DDHQ-MAIN/?format=json&pretty=yes&dynFieldDefaultAttr=false';
const POLL_INTERVAL_MS = 60_000;

export type VendorSource = {
  intervalMs: number;
  poller: VendorPoller;
  url: string;
};

export const makeVendorSource = (
  onObservations: (observations: RaceObservation[]) => void,
): VendorSource => {
  const poller = makeVendorPoller({ http: makeFetchHttp(), onObservations, url: CHAMELEON_URL });
  return { intervalMs: POLL_INTERVAL_MS, poller, url: CHAMELEON_URL };
};
