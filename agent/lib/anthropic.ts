import Anthropic from '@anthropic-ai/sdk';
import { bedrockModelId, defaultModelId, gatewayEnv } from './gateway.js';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const { url, key } = gatewayEnv();
    client = new Anthropic({
      // The gateway's Anthropic-native passthrough; the SDK appends
      // /v1/messages itself.
      baseURL: `${url}/anthropic`,
      // The gateway reads its virtual key from x-bf-vk and ignores the
      // standard auth headers, so the key has to go in both places — apiKey
      // to satisfy the SDK's own required-credential check.
      apiKey: key,
      defaultHeaders: { 'x-bf-vk': key },
    });
  }
  return client;
}

export interface GenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxTokens?: number;
}

/**
 * Call Claude with a system prompt and a user message. Returns the full text response.
 * Used by tools that need a dedicated Claude call with their own system prompt
 * (write_draft, copyedit_draft, blog_ideas).
 */
export async function generateText(opts: GenerateOptions): Promise<string> {
  const anthropic = getAnthropicClient();
  const response = await anthropic.messages.create({
    // Callers pass a bare gateway model ID (or nothing, for the quality path);
    // the passthrough needs it bedrock-prefixed.
    model: bedrockModelId(opts.model ?? defaultModelId()),
    max_tokens: opts.maxTokens ?? 8000,
    // Cache the system prompt — large SKILL.md prompts hit cache after the
    // first call, cutting TTFT significantly on repeated invocations. The
    // gateway passthrough forwards cache_control intact (verified against a
    // ~7k-token system block: cache_creation on call 1, cache_read on call 2).
    system: [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: opts.userPrompt }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude returned no text content');
  }
  return textBlock.text;
}

/**
 * Pull the JSON object out of a Claude response. Claude usually returns clean
 * JSON when instructed, but sometimes wraps it in ```json fences or adds a
 * stray sentence before/after. This strips fences and trims to the outermost
 * { ... } block before parsing. Returns `unknown` — caller validates the shape.
 */
export function parseJsonResponse(raw: string): unknown {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*\n/, '').replace(/\n```\s*$/, '');
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error(
      `Response did not contain a JSON object. Got: ${text.slice(0, 200)}...`,
    );
  }
  return JSON.parse(text.slice(first, last + 1));
}
