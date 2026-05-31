import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';
import type { HttpJson } from '../../src/sources/http.js';
import { makeVendorPoller } from '../../src/sources/vendor/poller.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(resolve(here, '..', '..', 'chameleon_response_example.json'), 'utf8'),
) as Record<string, unknown>;

const URL = 'http://vendor.test/playlist?format=json';

const makeHttp = (response: unknown | (() => unknown)): { gets: string[]; http: HttpJson } => {
  const gets: string[] = [];
  const http: HttpJson = {
    getJson: async (url) => {
      gets.push(url);
      const value = typeof response === 'function' ? (response as () => unknown)() : response;
      if (value instanceof Error) throw value;
      return value;
    },
    postJson: async () => {
      throw new Error('unused');
    },
  };
  return { gets, http };
};

describe('makeVendorPoller', () => {
  it('GETs the configured URL and adapts every contest to a vendor observation', async () => {
    const { http, gets } = makeHttp(sample);
    const observed: RaceObservation[] = [];
    const poller = makeVendorPoller({ http, onObservations: (o) => observed.push(...o), url: URL });
    await poller.pollOnce();
    expect(gets).toEqual([URL]);
    const contestCount = (
      (sample.ElectionPlaylist as Record<string, unknown>).contest as unknown[]
    ).length;
    expect(observed).toHaveLength(contestCount);
    expect(observed.every((o) => o.source === 'Ross')).toBe(true);
  });

  it('stamps observedAt from the injected clock', async () => {
    const { http } = makeHttp(sample);
    const observed: RaceObservation[] = [];
    const poller = makeVendorPoller({
      http,
      now: () => 1_700_000_000_000,
      onObservations: (o) => observed.push(...o),
      url: URL,
    });
    await poller.pollOnce();
    expect(observed[0]!.observedAt).toBe(1_700_000_000_000);
  });

  it('propagates a fetch error (so the scheduler can report it)', async () => {
    const { http } = makeHttp(() => new Error('HTTP 503 vendor down'));
    const poller = makeVendorPoller({ http, onObservations: () => {}, url: URL });
    await expect(poller.pollOnce()).rejects.toThrow(/503/);
  });
});
