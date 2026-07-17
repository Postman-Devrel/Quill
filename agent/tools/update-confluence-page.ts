import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateConfluencePage } from '../lib/confluence.js';

export const updateConfluencePageTool = createTool({
  id: 'update_confluence_page',
  description:
    'Overwrite an EXISTING Confluence page in place with revised markdown, bumping its version. Confluence keeps the prior version in page history, so the original is never lost. Use this when iterating on comment feedback: apply the edits the comments call for, then write the full revised draft back to the same page. Pass the complete markdown (including frontmatter) — not a diff. To create a brand-new page instead, use save_to_confluence.',
  inputSchema: z.object({
    urlOrId: z
      .string()
      .describe('The Confluence page URL or raw numeric page ID to update in place.'),
    markdown: z
      .string()
      .describe('The FULL revised markdown content, including any YAML frontmatter.'),
    title: z
      .string()
      .optional()
      .describe('New page title. Omit to keep the existing title.'),
  }),
  execute: async ({ urlOrId, markdown, title }) => {
    const t0 = Date.now();
    console.log(`[update_confluence_page] start: ${urlOrId.slice(0, 80)}`);
    try {
      const result = await updateConfluencePage({ idOrUrl: urlOrId, markdown, title });
      console.log(
        `[update_confluence_page] done in ${Date.now() - t0}ms (pageId=${result.pageId}, v${result.version})`,
      );
      return {
        success: true,
        pageId: result.pageId,
        title: result.title,
        pageUrl: result.pageUrl,
        spaceKey: result.spaceKey,
        version: result.version,
        identity: result.identity,
      };
    } catch (e) {
      console.log(
        `[update_confluence_page] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `update_confluence_page failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
