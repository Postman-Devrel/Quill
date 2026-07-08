import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText } from '../lib/anthropic.js';
import { getBlogWriteSystemPrompt } from '../prompts/blog-write.js';

const researchSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const writeDraftTool = createTool({
  id: 'write_draft',
  description:
    'Write a complete technical blog post (1200–1600 words) about an API or Postman-related topic. Returns markdown with YAML frontmatter including suggested_title, meta_description, primary_keyword, and SEO score. Call web_search 3–5 times in parallel BEFORE calling this tool, and pass the results as the research array so the draft can cite recent sources. The tool takes ~30 seconds; tell the user you are writing before calling it.',
  inputSchema: z.object({
    topic: z
      .string()
      .describe('The blog topic, e.g. "Testing OAuth 2.0 flows in Postman" or "MCP servers and how Postman supports them".'),
    research: z
      .array(researchSchema)
      .optional()
      .describe('Optional array of web_search results (title, url, snippet) to ground the draft in recent sources.'),
  }),
  execute: async ({ topic, research }) => {
    const t0 = Date.now();
    console.log(`[write_draft] start: topic=${JSON.stringify(topic)} research=${research?.length ?? 0}`);
    const researchBlock =
      research && research.length > 0
        ? `\n\n## Research provided\n\nThe following web_search results were gathered for this topic. Cite relevant ones with inline links:\n\n${research
            .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.snippet}`)
            .join('\n')}`
        : '\n\n_No research was provided. Write from your training knowledge and clearly note any claims that should be verified._';

    const userPrompt = `Write a Postman developer-advocate blog post on the following topic:\n\n**${topic}**${researchBlock}\n\nReturn ONLY the markdown blog post with YAML frontmatter. No preamble, no explanation.`;

    try {
      const systemPrompt = await getBlogWriteSystemPrompt();
      const draft = await generateText({
        systemPrompt,
        userPrompt,
        maxTokens: 8000,
      });
      console.log(`[write_draft] done in ${Date.now() - t0}ms (${draft.length} chars)`);
      return { draft, topic };
    } catch (e) {
      console.log(`[write_draft] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `write_draft failed: ${e instanceof Error ? e.message : String(e)}`,
        draft: '',
        topic,
      };
    }
  },
});
