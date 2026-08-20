/**
 * Astro AI gateway wiring.
 *
 * The platform injects ASTRO_GATEWAY_URL and ASTRO_GATEWAY_API_KEY, plus one
 * MODEL_<NAME> per named block under `models:` in astropods.yml that declares
 * `provider: gateway`. Quill declares two — `default` (quality) and `fast`
 * (cheap) — so it gets MODEL_DEFAULT and MODEL_FAST. There is no
 * ANTHROPIC_API_KEY under the gateway; all model traffic goes through the
 * gateway host.
 *
 * The gateway serves two endpoint families, and Quill uses both:
 *   - OpenAI-compatible  ${URL}/v1        Authorization: Bearer <key>
 *     Used by the Mastra agent (see agent/index.ts) via Mastra's
 *     OpenAICompatibleConfig.
 *   - Anthropic native   ${URL}/anthropic x-bf-vk: <key>
 *     Used by the direct @anthropic-ai/sdk calls in lib/anthropic.ts, which
 *     rely on Anthropic-shaped features (cache_control on the system block)
 *     that the OpenAI-compatible shape can't express.
 */

export interface GatewayEnv {
  url: string;
  key: string;
}

/**
 * Read + validate the injected gateway credentials. Throws a message that
 * points at the fix rather than letting a downstream 401 surface instead.
 */
export function gatewayEnv(): GatewayEnv {
  const url = process.env.ASTRO_GATEWAY_URL;
  const key = process.env.ASTRO_GATEWAY_API_KEY;
  if (!url || !key) {
    throw new Error(
      'ASTRO_GATEWAY_URL and ASTRO_GATEWAY_API_KEY are not set. The platform ' +
        'injects both when astropods.yml declares `models.default.provider: ' +
        'gateway`. Run: ast project configure',
    );
  }
  // Trailing slash would double up when we append /v1 or /anthropic.
  return { url: url.replace(/\/$/, ''), key };
}

/**
 * Read the model picked at deploy time for a named `models.<name>` block in
 * astropods.yml. The list in each block is a set of options, not a set of
 * concurrently-available models — exactly one is selected per deploy and
 * injected as MODEL_<NAME>.
 */
function selectedModel(name: 'default' | 'fast'): string {
  const envVar = `MODEL_${name.toUpperCase()}`;
  const model = process.env[envVar];
  if (!model) {
    throw new Error(
      `${envVar} is not set. The platform injects it from the ` +
        `\`models.${name}\` block in astropods.yml.`,
    );
  }
  return model;
}

/** Quality path: conversation routing, write_draft, copyedit_draft. */
export function defaultModelId(): string {
  return selectedModel('default');
}

/** Cheap path: blog_ideas scoring. */
export function fastModelId(): string {
  return selectedModel('fast');
}

/**
 * Convert a bare model ID to the form the Anthropic-native passthrough
 * expects — it requires a provider prefix (`bedrock/claude-sonnet-4-6`) and
 * 401s on bare `claude-*`. MODEL_<NAME> is injected bare, so prefix here, but
 * pass through anything already prefixed so a future injection format change
 * doesn't produce `bedrock/bedrock/...`.
 */
export function bedrockModelId(model: string): string {
  return model.includes('/') ? model : `bedrock/${model}`;
}
