import { Agent } from '@mastra/core/agent';
import { Mastra } from '@mastra/core/mastra';
import { Memory } from '@mastra/memory';
import { LibSQLStore } from '@mastra/libsql';
import { Observability } from '@mastra/observability';
import { OtelExporter } from '@mastra/otel-exporter';
import { MastraAdapter } from '@astropods/adapter-mastra';
import {
  serve,
  type AgentAdapter,
  type StreamHooks,
  type StreamOptions,
} from '@astropods/adapter-core';

import { QUILL_INSTRUCTIONS } from './instructions.js';
import { userContextStorage } from './lib/user-context.js';
import {
  webSearchTool,
  writeDraftTool,
  copyeditDraftTool,
  stageToWordPressTool,
  findNextWpSlotTool,
  rescheduleWpPostTool,
  listWpScheduleTool,
  blogIdeasTool,
  wpPublishStatsTool,
  checkBlogCoverageTool,
  saveToConfluenceTool,
  readConfluenceTool,
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
  model: 'anthropic/claude-sonnet-4-5',
  memory,
  tools: {
    web_search: webSearchTool,
    write_draft: writeDraftTool,
    copyedit_draft: copyeditDraftTool,
    stage_to_wordpress: stageToWordPressTool,
    find_next_wp_slot: findNextWpSlotTool,
    reschedule_wp_post: rescheduleWpPostTool,
    list_wp_schedule: listWpScheduleTool,
    blog_ideas: blogIdeasTool,
    wp_publish_stats: wpPublishStatsTool,
    check_blog_coverage: checkBlogCoverageTool,
    save_to_confluence: saveToConfluenceTool,
    read_confluence: readConfluenceTool,
  },
  defaultOptions: {
    tracingOptions: {
      tags: ['astro', 'agent:quill'],
      metadata: { agent_id: 'quill' },
    },
  },
});

new Mastra({ agents: { quill: agent }, observability });

/**
 * Wrap MastraAdapter to capture the current Slack user (options.userId) into
 * AsyncLocalStorage for the duration of each stream() call. Tools read this
 * via getCurrentUser() so per-user credentials (e.g. Confluence tokens) work.
 */
class UserContextAdapter implements AgentAdapter {
  readonly name: string;
  streamAudio?: AgentAdapter['streamAudio'];

  constructor(private readonly inner: AgentAdapter) {
    this.name = inner.name;
    if (inner.streamAudio) this.streamAudio = inner.streamAudio.bind(inner);
  }

  async stream(prompt: string, hooks: StreamHooks, options: StreamOptions) {
    return userContextStorage.run(
      { userId: options.userId, conversationId: options.conversationId },
      () => this.inner.stream(prompt, hooks, options),
    );
  }

  getConfig() {
    return this.inner.getConfig();
  }
}

serve(new UserContextAdapter(new MastraAdapter(agent)));
