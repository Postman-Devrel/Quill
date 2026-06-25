import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const webSearchTool = createTool({
  id: 'web_search',
  description:
    'Search the web for trending topics, technical articles, competitor coverage, and research material. Use this before drafting a blog post (to gather context) or when generating blog ideas. Pass a single focused query per call; for broader research, call this tool multiple times in parallel with different queries.',
  inputSchema: z.object({
    query: z.string().describe('A single focused search query, e.g. "MCP server Postman testing" or "API observability trends 2026".'),
  }),
  execute: async ({ query }) => {
    const t0 = Date.now();
    console.log(`[web_search] start: query=${JSON.stringify(query)}`);
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return {
        error: 'TAVILY_API_KEY not configured. Run: ast project configure',
        results: [],
      };
    }

    try {
      const resp = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'basic',
          max_results: 10,
          include_answer: false,
          include_images: false,
        }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        return {
          error: `Tavily API error: HTTP ${resp.status} — ${err}`,
          results: [],
        };
      }

      const data = (await resp.json()) as {
        results?: Array<{ title: string; url: string; content: string; score: number }>;
      };

      const results = (data.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.content,
        score: r.score,
      }));

      console.log(`[web_search] done in ${Date.now() - t0}ms (${results.length} results)`);
      return { query, results };
    } catch (e) {
      console.log(`[web_search] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `web_search failed: ${e instanceof Error ? e.message : String(e)}`,
        results: [],
      };
    }
  },
});
