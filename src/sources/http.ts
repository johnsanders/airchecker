// Minimal JSON-over-HTTP seam, injected into pollers so they're testable without
// network. The default impl wraps the global fetch (Node 18+); tests pass a fake.
export type HttpJson = {
  getJson: (url: string, headers?: Record<string, string>) => Promise<unknown>;
  postJson: (url: string, body: unknown, headers?: Record<string, string>) => Promise<unknown>;
};

const ensureOk = async (response: Response, url: string): Promise<unknown> => {
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} for ${url}${text.length > 0 ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return response.json();
};

export const makeFetchHttp = (): HttpJson => ({
  getJson: async (url, headers) =>
    ensureOk(await fetch(url, { headers: { Accept: 'application/json', ...headers } }), url),
  postJson: async (url, body, headers) =>
    ensureOk(
      await fetch(url, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        method: 'POST',
      }),
      url,
    ),
});
