// Scrubs Anthropic API keys from any string before it's logged — defence in
// depth for error paths that might surface a key (the SDK already masks it).
// Removes both the live env value and anything shaped like an sk-ant- token.
export const redactSecrets = (text: string): string => {
  const envKey = process.env.ANTHROPIC_API_KEY;
  const withoutEnv =
    envKey === undefined || envKey.length === 0 ? text : text.split(envKey).join('[REDACTED]');
  return withoutEnv.replace(/sk-ant-[A-Za-z0-9_-]+/g, '[REDACTED]');
};

export const redactError = (error: unknown): string => {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  return redactSecrets(text);
};
