import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { MastraAdapter } from '@astropods/adapter-mastra';
import { serve } from '@astropods/adapter-core';

import { QUILL_INSTRUCTIONS } from './instructions.js';
import {
  webSearchTool,
  writeDraftTool,
  copyeditDraftTool,
  stageToWordPressTool,
  findNextWpSlotTool,
  listWpScheduleTool,
  blogIdeasTool,
  wpPublishStatsTool,
  checkBlogCoverageTool,
  saveToConfluenceTool,
  readConfluenceTool,
  createHeaderRequestTool,
} from './tools/index.js';

function resolveOtlpEndpoint(): string {
  const raw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';
  try {
    const u = new URL(raw);
    if (!u.pathname || u.pathname === '/') u.pathname = '/v1/traces';
    return u.toString();
  } catch {
    return `${raw.replace(/\/+$/, '')}/v1/traces`;
  }
}

const memory = new Memory({
  storage: new LibSQLStore({ id: 'quill-memory', url: ':memory:' }),
});

const observability = new Observability({
  configs: {
    otel: {
      serviceName: 'quill',
      exporters: [
        new OtelExporter({
          provider: {
            custom: {
              endpoint: resolveOtlpEndpoint(),
              protocol: 'http/protobuf',
            },
          },
        }),
      ],
    },
  },
});

const agent = new Agent({
  id: 'quill',
  name: 'Quill',
  instructions: () => QUILL_INSTRUCTIONS,
  model: 'anthropic/claude-opus-4-7',
  memory,
  tools: {
    web_search: webSearchTool,
    write_draft: writeDraftTool,
    copyedit_draft: copyeditDraftTool,
    stage_to_wordpress: stageToWordPressTool,
    find_next_wp_slot: findNextWpSlotTool,
    list_wp_schedule: listWpScheduleTool,
    blog_ideas: blogIdeasTool,
    wp_publish_stats: wpPublishStatsTool,
    check_blog_coverage: checkBlogCoverageTool,
    save_to_confluence: saveToConfluenceTool,
    read_confluence: readConfluenceTool,
    create_header_request: createHeaderRequestTool,
  },
  defaultOptions: {
    tracingOptions: {
      tags: ['astro', 'agent:quill'],
      metadata: { agent_id: 'quill' },
    },
  },
});

new Mastra({ agents: { quill: agent }, observability });

// MastraAdapter calls agent.stream() without maxSteps, defaulting to 5 — far
// too low for Quill's multi-tool pipelines. Proxy the agent to inject a higher
// limit. All non-stream properties are bound to the original target so private
// class fields (#instructions etc.) remain accessible.
const agentWithMaxSteps = new Proxy(agent, {
  get(target, prop) {
    if (prop === 'stream') {
      return (messages: unknown, options: Record<string, unknown> = {}) =>
        (target as unknown as Record<string, Function>).stream(messages, { ...options, maxSteps: 25 });
    }
    const value = (target as unknown as Record<string, unknown>)[prop as string];
    return typeof value === 'function' ? (value as Function).bind(target) : value;
  },
});

serve(new MastraAdapter(agentWithMaxSteps as unknown as typeof agent));
