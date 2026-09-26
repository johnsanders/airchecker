// Transient failures — a dropped connection (undici surfaces it as
// TypeError: fetch failed), a 429, or a 5xx — get two retries with backoff,
// matching the Anthropic SDK's default. Everything else (other 4xx) surfaces
// immediately as an Error naming the status and the first 300 bytes of the body.
export type PostJsonOptions = {
	body: string;
	fetchImpl: typeof fetch;
	headers: Record<string, string>;
	label: string;
	retryDelaysMs: readonly number[];
	url: string;
};

export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 2000];

const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const postJsonWithRetry = async (options: PostJsonOptions): Promise<Response> => {
	const send = async (attempt: number): Promise<Response> => {
		const retry = async (): Promise<Response> => {
			await sleep(options.retryDelaysMs[attempt] ?? 0);
			return send(attempt + 1);
		};
		const canRetry = attempt < options.retryDelaysMs.length;
		let response: Response;
		try {
			response = await options.fetchImpl(options.url, {
				body: options.body,
				headers: options.headers,
				method: 'POST',
			});
		} catch (error) {
			if (canRetry && error instanceof TypeError) return retry();
			throw error;
		}
		if (response.ok) return response;
		if (canRetry && isTransientStatus(response.status)) return retry();
		const text = await response.text().catch(() => '');
		throw new Error(`${options.label} HTTP ${response.status}: ${text.slice(0, 300)}`);
	};
	return send(0);
};
