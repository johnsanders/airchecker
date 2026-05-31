import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { redactError, redactSecrets } from '../../src/vision/redact.js';

describe('redactSecrets', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secretvalue123';
  });
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('scrubs the exact env key value', () => {
    expect(redactSecrets('boom: sk-ant-secretvalue123 happened')).toBe('boom: [REDACTED] happened');
  });

  it('scrubs any sk-ant- shaped token even if it is not the env value', () => {
    expect(redactSecrets('header x-api-key: sk-ant-api03-AbC_def-XYZ')).toBe(
      'header x-api-key: [REDACTED]',
    );
  });

  it('leaves non-secret text untouched', () => {
    expect(redactSecrets('plain error, no secrets')).toBe('plain error, no secrets');
  });

  it('redactError pulls and scrubs an Error message', () => {
    expect(redactError(new Error('failed with sk-ant-secretvalue123'))).toContain('[REDACTED]');
  });
});
