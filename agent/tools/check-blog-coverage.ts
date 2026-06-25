import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { searchWordPressPosts } from '../lib/wordpress.js';

export const checkBlogCoverageTool = createTool({
  id: 'check_blog_coverage',
  description:
    'Search blog.postman.com for existing posts on a topic — across published, scheduled, draft, and pending statuses. ALWAYS call this BEFORE write_draft so Quill does not write something already covered. Returns up to 5 most-relevant existing posts with title, status, date, URL, and excerpt. If matches come back, surface them to the user and confirm before drafting (the user may still want a fresh angle, an update, or to write something different).',
  inputSchema: z.object({
    topic: z
      .string()
      .describe(
        'The topic the user wants to write about. Be specific enough that the search returns useful matches.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe('How many results to return. Defaults to 5.'),
  }),
  execute: async ({ topic, limit }) => {
    const t0 = Date.now();
    console.log(`[check_blog_coverage] start: topic=${JSON.stringify(topic)}`);
    try {
      const posts = await searchWordPressPosts(topic, limit ?? 5);
      console.log(
        `[check_blog_coverage] done in ${Date.now() - t0}ms (${posts.length} matches)`,
      );
      return {
        success: true,
        topic,
        matchCount: posts.length,
        existingPosts: posts,
      };
    } catch (e) {
      console.log(
        `[check_blog_coverage] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `check_blog_coverage failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
