import { describe, expect, it } from 'vitest';

import type { HttpJson } from '../../src/sources/http.js';
import { makeDdhqAuth } from '../../src/sources/provider/auth.js';

const credentials = { clientId: 'id', clientSecret: 'secret', grantType: 'client_credentials' };

// Records POST bodies + lets each test script the token responses.
const makeHttp = (tokens: unknown[]): { http: HttpJson; posts: { body: unknown; url: string }[] } => {
  const posts: { body: unknown; url: string }[] = [];
  let index = 0;
  const http: HttpJson = {
    getJson: async () => {
      throw new Error('unused');
    },
    postJson: async (url, body) => {
      posts.push({ body, url });
      const next = tokens[Math.min(index, tokens.length - 1)];
      index += 1;
      return next;
    },
  };
  return { http, posts };
};

describe('makeDdhqAuth', () => {
  it('POSTs credentials to the token endpoint and returns the access_token', async () => {
    const { http, posts } = makeHttp([{ access_token: 'tok-1', expires_in: 300 }]);
    const auth = makeDdhqAuth({ baseUrl: 'https://api.test', credentials, http, now: () => 0 });
    expect(await auth.getToken()).toBe('tok-1');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://api.test/api/v4/oauth/token');
    expect(posts[0]!.body).toEqual({
      client_id: 'id',
      client_secret: 'secret',
      grant_type: 'client_credentials',
    });
  });

  it('caches the token across calls within its TTL', async () => {
    const { http, posts } = makeHttp([{ access_token: 'tok-1', expires_in: 300 }]);
    let clock = 0;
    const auth = makeDdhqAuth({ baseUrl: 'https://api.test', credentials, http, now: () => clock });
    await auth.getToken();
    clock = 100_000; // well within 300s TTL minus skew
    await auth.getToken();
    expect(posts).toHaveLength(1); // reused, not refetched
  });

  it('refreshes once the token is within the skew window of expiry', async () => {
    const { http, posts } = makeHttp([
      { access_token: 'tok-1', expires_in: 300 },
      { access_token: 'tok-2', expires_in: 300 },
    ]);
    let clock = 0;
    const auth = makeDdhqAuth({
      baseUrl: 'https://api.test',
      credentials,
      http,
      now: () => clock,
      refreshSkewMs: 60_000,
    });
    expect(await auth.getToken()).toBe('tok-1');
    clock = 250_000; // 250s in; expiry 300s, skew 60s → 240s threshold passed
    expect(await auth.getToken()).toBe('tok-2');
    expect(posts).toHaveLength(2);
  });

  it('refetches after invalidate()', async () => {
    const { http, posts } = makeHttp([
      { access_token: 'tok-1', expires_in: 300 },
      { access_token: 'tok-2', expires_in: 300 },
    ]);
    const auth = makeDdhqAuth({ baseUrl: 'https://api.test', credentials, http, now: () => 0 });
    expect(await auth.getToken()).toBe('tok-1');
    auth.invalidate();
    expect(await auth.getToken()).toBe('tok-2');
    expect(posts).toHaveLength(2);
  });
});
