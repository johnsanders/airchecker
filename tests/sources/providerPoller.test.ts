import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { RaceObservation } from '../../src/reconcile/reconcile.js';
import type { HttpJson } from '../../src/sources/http.js';
import type { DdhqAuth } from '../../src/sources/provider/auth.js';
import { makeProviderPoller } from '../../src/sources/provider/poller.js';

const here = dirname(fileURLToPath(import.meta.url));
const sample = JSON.parse(
  readFileSync(resolve(here, '..', '..', 'ddhq_response_example.json'), 'utf8'),
) as Record<string, unknown>;

const stubAuth = (): DdhqAuth => ({ getToken: async () => 'tok', invalidate: () => {} });

// HttpJson whose GET is scripted by a url→response map (functions allowed for errors).
const makeHttp = (
  routes: Record<string, unknown | (() => unknown)>,
): { gets: string[]; http: HttpJson } => {
  const gets: string[] = [];
  const http: HttpJson = {
    getJson: async (url) => {
      gets.push(url);
      const route = routes[url];
      if (route === undefined) throw new Error(`HTTP 404 no route for ${url}`);
      const value = typeof route === 'function' ? (route as () => unknown)() : route;
      if (value instanceof Error) throw value;
      return value;
    },
    postJson: async () => {
      throw new Error('unused');
    },
  };
  return { gets, http };
};

const baseUrl = 'https://api.test';

describe('makeProviderPoller', () => {
  it('adapts every race from the real sample into provider observations', async () => {
    const { http } = makeHttp({ [`${baseUrl}/api/v4/races?race_ids=1`]: { ...sample, next_page_url: null } });
    const observed: RaceObservation[] = [];
    const poller = makeProviderPoller({
      auth: stubAuth(),
      baseUrl,
      http,
      onObservations: (obs) => observed.push(...obs),
      queries: ['race_ids=1'],
    });
    await poller.pollOnce();
    expect(observed.length).toBe((sample.data as unknown[]).length);
    expect(observed.every((o) => o.source === 'DDHQ')).toBe(true);
  });

  it('runs every query in the configured array', async () => {
    const oneRace = { ...sample, data: [(sample.data as unknown[])[0]], next_page_url: null };
    const { http, gets } = makeHttp({
      [`${baseUrl}/api/v4/races?race_ids=1`]: oneRace,
      [`${baseUrl}/api/v4/races?state=TX`]: oneRace,
    });
    const observed: RaceObservation[] = [];
    const poller = makeProviderPoller({
      auth: stubAuth(),
      baseUrl,
      http,
      onObservations: (obs) => observed.push(...obs),
      queries: ['race_ids=1', 'state=TX'],
    });
    await poller.pollOnce();
    expect(gets).toContain(`${baseUrl}/api/v4/races?race_ids=1`);
    expect(gets).toContain(`${baseUrl}/api/v4/races?state=TX`);
    expect(observed).toHaveLength(2);
  });

  it('follows next_page_url to drain all pages', async () => {
    const page1 = { ...sample, data: [(sample.data as unknown[])[0]], next_page_url: `${baseUrl}/page2` };
    const page2 = { ...sample, data: [(sample.data as unknown[])[1]], next_page_url: null };
    const { http } = makeHttp({
      [`${baseUrl}/api/v4/races?race_ids=1`]: page1,
      [`${baseUrl}/page2`]: page2,
    });
    const observed: RaceObservation[] = [];
    const poller = makeProviderPoller({
      auth: stubAuth(),
      baseUrl,
      http,
      onObservations: (obs) => observed.push(...obs),
      queries: ['race_ids=1'],
    });
    await poller.pollOnce();
    expect(observed).toHaveLength(2);
  });

  it('isolates a failing query and reports it without sinking the others', async () => {
    const oneRace = { ...sample, data: [(sample.data as unknown[])[0]], next_page_url: null };
    const { http } = makeHttp({
      [`${baseUrl}/api/v4/races?good=1`]: oneRace,
      [`${baseUrl}/api/v4/races?bad=1`]: () => new Error('HTTP 500 boom'),
    });
    const observed: RaceObservation[] = [];
    const errors: string[] = [];
    const poller = makeProviderPoller({
      auth: stubAuth(),
      baseUrl,
      http,
      onError: (query) => errors.push(query),
      onObservations: (obs) => observed.push(...obs),
      queries: ['good=1', 'bad=1'],
    });
    await poller.pollOnce();
    expect(observed).toHaveLength(1); // the good query still landed
    expect(errors).toEqual(['bad=1']);
  });

  it('invalidates the token and retries once on a 401', async () => {
    const oneRace = { ...sample, data: [(sample.data as unknown[])[0]], next_page_url: null };
    let calls = 0;
    let invalidated = false;
    const auth: DdhqAuth = {
      getToken: async () => 'tok',
      invalidate: () => {
        invalidated = true;
      },
    };
    const http: HttpJson = {
      getJson: async () => {
        calls += 1;
        if (calls === 1) throw new Error('HTTP 401 unauthorized');
        return oneRace;
      },
      postJson: async () => {
        throw new Error('unused');
      },
    };
    const observed: RaceObservation[] = [];
    const poller = makeProviderPoller({
      auth,
      baseUrl,
      http,
      onObservations: (obs) => observed.push(...obs),
      queries: ['race_ids=1'],
    });
    await poller.pollOnce();
    expect(invalidated).toBe(true);
    expect(calls).toBe(2); // failed once, retried, succeeded
    expect(observed).toHaveLength(1);
  });
});
