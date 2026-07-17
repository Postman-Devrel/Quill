import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { replyToConfluenceComment } from '../lib/confluence.js';

export const replyConfluenceCommentTool = createTool({
  id: 'reply_confluence_comment',
  description:
    'Post a reply to an existing Confluence comment (inline or footer). Call this AFTER applying a change from a comment so reviewers see what was done — e.g. "Addressed: tightened the intro and cut the passive voice." Keep replies short and specific to that comment. Use the commentId returned by read_confluence_comments.',
  inputSchema: z.object({
    commentId: z
      .string()
      .describe('The commentId to reply to (from read_confluence_comments output).'),
    markdown: z
      .string()
      .describe(
        'The reply text (markdown). Say what was changed in response to the comment, e.g. "Addressed: changed X to Y."',
      ),
  }),
  execute: async ({ commentId, markdown }) => {
    const t0 = Date.now();
    console.log(`[reply_confluence_comment] start: comment=${commentId}`);
    try {
      const result = await replyToConfluenceComment({ commentId, markdown });
      console.log(
        `[reply_confluence_comment] done in ${Date.now() - t0}ms (replyId=${result.replyId})`,
      );
      return {
        success: true,
        replyId: result.replyId,
        commentId,
        identity: result.identity,
      };
    } catch (e) {
      console.log(
        `[reply_confluence_comment] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `reply_confluence_comment failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
