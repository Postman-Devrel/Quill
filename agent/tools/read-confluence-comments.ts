import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readConfluenceComments } from '../lib/confluence.js';

export const readConfluenceCommentsTool = createTool({
  id: 'read_confluence_comments',
  description:
    'Read ALL comments (inline + footer) on a Confluence page. Call this when the user asks Quill to "read the comments", "address the feedback", or "iterate on comments" for a page. Returns each comment with its type, author, text, resolution status, and (for inline comments) the highlighted page text the comment is anchored to. Pair with read_confluence to get the page body, then work through the comments one at a time — apply clear edits with update_confluence_page, and ask the user how to proceed on ambiguous ones.',
  inputSchema: z.object({
    urlOrId: z
      .string()
      .describe(
        'A Confluence page URL or the raw numeric page ID whose comments should be read.',
      ),
  }),
  execute: async ({ urlOrId }) => {
    const t0 = Date.now();
    console.log(`[read_confluence_comments] start: ${urlOrId.slice(0, 80)}`);
    try {
      const { pageId, comments } = await readConfluenceComments(urlOrId);
      const openInline = comments.filter(
        (c) => c.type === 'inline' && c.resolution !== 'resolved',
      ).length;
      console.log(
        `[read_confluence_comments] done in ${Date.now() - t0}ms (${comments.length} comments, ${openInline} open inline)`,
      );
      return {
        success: true,
        pageId,
        commentCount: comments.length,
        comments,
      };
    } catch (e) {
      console.log(
        `[read_confluence_comments] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `read_confluence_comments failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
