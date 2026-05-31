import { createHash } from 'node:crypto';

import { hashPrompt } from './llmClient.js';
import type { LlmClient, LlmResponse } from './llmClient.js';

// A golden = a frame's recorded VLM response, keyed by (frameHash, promptHash).
// Replaying it needs no API key and is deterministic. If the prompt drifts (the
// menu/schema changed), the promptHash won't match and the stub throws loudly —
// that's the signal to re-record, not a silent wrong answer.
export type Golden = {
  frameSha256: string;
  model: string;
  promptHash: string;
  response: unknown;
};

export const makeGoldenClient = (goldens: readonly Golden[]): LlmClient => ({
  call: async (request): Promise<LlmResponse> => {
    const frameSha256 =
      request.image === undefined
        ? null
        : createHash('sha256').update(Buffer.from(request.image.base64, 'base64')).digest('hex');
    const promptHash = hashPrompt(request);
    const hit = goldens.find(
      (golden) => golden.frameSha256 === frameSha256 && golden.promptHash === promptHash,
    );
    if (hit === undefined)
      throw new Error(
        `golden miss: frameSha256=${frameSha256 ?? '<none>'} promptHash=${promptHash} — prompt or frame changed; re-record the golden`,
      );
    return { body: hit.response, model: hit.model };
  },
});
