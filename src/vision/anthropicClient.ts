import Anthropic from '@anthropic-ai/sdk';

import type { LlmClient } from './llmClient.js';

// The real Messages-API client. Builds an image + text user turn and forces the
// reporting tool. Live mode only — an ANTHROPIC_API_KEY must be present (the SDK
// reads it from the environment).
//
// No prompt caching: measured, the stable prefix (tools + menu) is ~1,200 tokens —
// below Haiku 4.5's 4,096-token cache minimum, so cache_control would be a silent
// no-op — and the per-frame image (~1,560 tokens, the bulk of the cost) is unique
// every frame and uncacheable. The cost lever here is capture cadence, not caching.
export type AnthropicLlmClientOptions = {
  apiKey?: string;
  maxTokens?: number;
};

export const makeAnthropicLlmClient = (options: AnthropicLlmClientOptions = {}): LlmClient => {
  const client = new Anthropic(options.apiKey === undefined ? {} : { apiKey: options.apiKey });
  const maxTokens = options.maxTokens ?? 4096;
  return {
    call: async (request) => {
      const content: Anthropic.ContentBlockParam[] = [];
      if (request.image !== undefined)
        content.push({
          source: { data: request.image.base64, media_type: request.image.mediaType, type: 'base64' },
          type: 'image',
        });
      content.push({ text: request.prompt, type: 'text' });

      const params: Anthropic.MessageCreateParamsNonStreaming = {
        max_tokens: maxTokens,
        messages: [{ content, role: 'user' }],
        model: request.model,
      };
      if (request.tool !== undefined) {
        params.tools = [
          {
            description: request.tool.description,
            input_schema: request.tool.inputSchema as Anthropic.Tool.InputSchema,
            name: request.tool.name,
          },
        ];
        if (request.toolChoice !== undefined)
          params.tool_choice = { name: request.toolChoice, type: 'tool' };
      }

      const response = await client.messages.create(params);
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      return { body: toolUse === undefined ? null : toolUse.input, model: response.model };
    },
  };
};
