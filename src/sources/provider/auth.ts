import { z } from 'zod';

import type { HttpJson } from '../http.js';

// DDHQ OAuth (client_credentials): POST {client_id, client_secret, grant_type} to
// /api/v4/oauth/token → bearer token. Tokens are cached and reused across queries
// and ticks, refreshed shortly before expiry. Credentials come from process.env
// at the call site — they never live in this module or pass through logs.
const tokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  token_type: z.string().optional(),
});

export type DdhqCredentials = {
  clientId: string;
  clientSecret: string;
  grantType: string;
};

export type DdhqAuthConfig = {
  baseUrl: string;
  credentials: DdhqCredentials;
  http: HttpJson;
  now?: () => number; // injectable clock for tests
  refreshSkewMs?: number; // refresh this long before expiry
};

export type DdhqAuth = {
  getToken: () => Promise<string>;
  invalidate: () => void; // drop the cached token (e.g. after a 401)
};

const DEFAULT_TTL_SECONDS = 300;

export const makeDdhqAuth = (config: DdhqAuthConfig): DdhqAuth => {
  const now = config.now ?? Date.now;
  const skewMs = config.refreshSkewMs ?? 60_000;
  let cached: { expiresAt: number; token: string } | undefined;

  const getToken = async (): Promise<string> => {
    const current = now();
    if (cached !== undefined && cached.expiresAt - skewMs > current) return cached.token;
    const raw = await config.http.postJson(`${config.baseUrl}/api/v4/oauth/token`, {
      client_id: config.credentials.clientId,
      client_secret: config.credentials.clientSecret,
      grant_type: config.credentials.grantType,
    });
    const parsed = tokenResponseSchema.parse(raw);
    const ttlMs = (parsed.expires_in ?? DEFAULT_TTL_SECONDS) * 1000;
    cached = { expiresAt: current + ttlMs, token: parsed.access_token };
    return cached.token;
  };

  return {
    getToken,
    invalidate: () => {
      cached = undefined;
    },
  };
};
