import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createConfluencePage } from '../lib/confluence.js';

export const saveToConfluenceTool = createTool({
  id: 'save_to_confluence',
  description:
    'Save a markdown blog draft to Confluence as a new page. ALWAYS call this immediately after write_draft AND after copyedit_draft so every draft + every edit gets a Confluence URL. Pass the suggested_title (or seoTitle for edits) and the FULL markdown including frontmatter. Returns pageUrl + pageId.',
  inputSchema: z.object({
    title: z
      .string()
      .describe(
        'Title for the Confluence page. Use suggested_title (first drafts) or seoTitle (edits).',
      ),
    markdown: z
      .string()
      .describe('Full markdown content, including any YAML frontmatter.'),
    spaceKey: z
      .string()
      .optional()
      .describe('Confluence space key. Defaults to CONFLUENCE_SPACE_KEY env var.'),
    parentPageId: z
      .string()
      .optional()
      .describe(
        'Parent page ID to nest under. Defaults to CONFLUENCE_PARENT_PAGE_ID env var; root of space if neither is set.',
      ),
  }),
  execute: async ({ title, markdown, spaceKey, parentPageId }) => {
    const t0 = Date.now();
    console.log(`[save_to_confluence] start: title=${JSON.stringify(title)}`);
    try {
      const result = await createConfluencePage({ title, markdown, spaceKey, parentPageId });
      console.log(
        `[save_to_confluence] done in ${Date.now() - t0}ms (pageId=${result.pageId}, identity=${result.identity})`,
      );
      return {
        success: true,
        pageId: result.pageId,
        title: result.title,
        pageUrl: result.pageUrl,
        spaceKey: result.spaceKey,
        identity: result.identity,
      };
    } catch (e) {
      console.log(
        `[save_to_confluence] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `save_to_confluence failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
