// Scrubs API keys from any string before it's logged — defence in depth for
// error paths that might surface a key (the Anthropic SDK already masks its
// own). Removes the live env values and anything shaped like a vendor token.
const KEY_ENV_NAMES = ['ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY'];

export const redactSecrets = (text: string): string => {
	const withoutEnv = KEY_ENV_NAMES.reduce((acc, name) => {
		const value = process.env[name];
		return value === undefined || value.length === 0 ? acc : acc.split(value).join('[REDACTED]');
	}, text);
	return withoutEnv.replace(/sk-(?:ant|or)-[A-Za-z0-9_-]+/g, '[REDACTED]');
};

export const redactError = (error: unknown): string => {
	const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
	return redactSecrets(text);
};
