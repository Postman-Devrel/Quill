import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set. Run: ast project configure');
    }
    client = new Anthropic({ apiKey });
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
    model: opts.model ?? 'claude-opus-4-7',
    max_tokens: opts.maxTokens ?? 8000,
    // Cache the system prompt at Anthropic — large SKILL.md prompts hit cache
    // after the first call, cutting TTFT significantly on repeated invocations.
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
