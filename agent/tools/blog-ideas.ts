import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, parseJsonResponse } from '../lib/anthropic.js';
import { getBlogIdeasSystemPrompt } from '../prompts/blog-ideas.js';

interface BlogIdea {
  title: string;
  angle: string;
  primaryKeyword: string;
  score: number;
  urgency: string;
  whyNow: string;
  postmanTieIn: string;
}

interface BlogIdeasResult {
  focusArea: string;
  ideasCount: number;
  ideas: BlogIdea[];
}

function validateIdeasResult(raw: unknown): BlogIdeasResult {
  const p = raw as Partial<BlogIdeasResult>;
  if (!Array.isArray(p.ideas)) {
    throw new Error('blog_ideas response missing "ideas" array.');
  }
  const ideas = p.ideas.map((i, idx) => {
    const x = i as Partial<BlogIdea>;
    if (typeof x.title !== 'string' || typeof x.score !== 'number') {
      throw new Error(`Idea #${idx + 1} missing title or score.`);
    }
    return {
      title: x.title,
      angle: typeof x.angle === 'string' ? x.angle : '',
      primaryKeyword: typeof x.primaryKeyword === 'string' ? x.primaryKeyword : '',
      score: x.score,
      urgency: typeof x.urgency === 'string' ? x.urgency : '',
      whyNow: typeof x.whyNow === 'string' ? x.whyNow : '',
      postmanTieIn: typeof x.postmanTieIn === 'string' ? x.postmanTieIn : '',
    };
  });
  return {
    focusArea: typeof p.focusArea === 'string' ? p.focusArea : '',
    ideasCount: ideas.length,
    ideas,
  };
}

const researchSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
});

export const blogIdeasTool = createTool({
  id: 'blog_ideas',
  description:
    'Generate 8–12 scored blog post ideas for blog.postman.com. Each idea gets a 0–100 trend score across 5 weighted criteria (search buzz, content gap, Postman relevance, audience fit, timeliness) plus an urgency tier, why-now rationale, and Postman tie-in. BEFORE calling this tool, run web_search 8–12 times in parallel covering: the focus area + "Postman"/"API", dev community sites (dev.to, Reddit, Hacker News), competitor blog coverage, and content-gap searches against blog.postman.com itself. Pass the results as the research array.',
  inputSchema: z.object({
    focusArea: z
      .string()
      .optional()
      .describe(
        'Optional focus area, e.g. "MCP", "API security", "testing". If omitted, scores broad AI/API trends.',
      ),
    research: z
      .array(researchSchema)
      .min(1)
      .describe(
        'Array of web_search results (title, url, snippet) gathered BEFORE this call. Required — without research the scoring is just LLM guesses.',
      ),
  }),
  execute: async ({ focusArea, research }) => {
    const t0 = Date.now();
    const focus = focusArea?.trim() || 'General AI & API trends';
    console.log(`[blog_ideas] start: focusArea=${JSON.stringify(focus)} research=${research.length}`);
    const researchBlock = research
      .map((r, i) => `${i + 1}. [${r.title}](${r.url}) — ${r.snippet}`)
      .join('\n');

    const userPrompt = `Focus area: **${focus}**\n\n## Research signals (${research.length} results)\n\n${researchBlock}\n\nScore and rank 8–12 blog post ideas. Return ONLY the JSON object described in the system prompt.`;

    try {
      const raw = await generateText({
        systemPrompt: await getBlogIdeasSystemPrompt(),
        userPrompt,
        model: 'claude-haiku-4-5-20251001',
        maxTokens: 2500,
      });
      const result = validateIdeasResult(parseJsonResponse(raw));
      console.log(`[blog_ideas] done in ${Date.now() - t0}ms (${result.ideas.length} ideas)`);
      return { success: true, ...result };
    } catch (e) {
      console.log(`[blog_ideas] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `blog_ideas failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
