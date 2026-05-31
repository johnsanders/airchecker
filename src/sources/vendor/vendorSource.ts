import type { RaceObservation } from '../../reconcile/reconcile.js';
import { makeFetchHttp } from '../http.js';
import { makeVendorPoller } from './poller.js';
import type { VendorPoller } from './poller.js';

// Assembles the live Chameleon vendor source from env.
//   CHAMELEON_URL          the playlist endpoint (required; VPN-only)
//   CHAMELEON_POLL_INTERVAL_MS  (default 60000 — once per minute)

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export type VendorSource = {
  intervalMs: number;
  poller: VendorPoller;
  url: string;
};

export const makeVendorSource = (
  onObservations: (observations: RaceObservation[]) => void,
): VendorSource => {
  const url = process.env.CHAMELEON_URL;
  if (url === undefined || url.trim().length === 0)
    throw new Error('CHAMELEON_URL must be set');

  const intervalRaw = Number(process.env.CHAMELEON_POLL_INTERVAL_MS);
  const intervalMs =
    Number.isFinite(intervalRaw) && intervalRaw > 0 ? intervalRaw : DEFAULT_POLL_INTERVAL_MS;

  const poller = makeVendorPoller({ http: makeFetchHttp(), onObservations, url });
  return { intervalMs, poller, url };
};
