import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readConfluencePage } from '../lib/confluence.js';

export const readConfluenceTool = createTool({
  id: 'read_confluence',
  description:
    'Read a Confluence page and return its contents as markdown. ALWAYS call this FIRST when the user pastes a Confluence page URL — the markdown output then feeds into the appropriate next tool (copyedit_draft, write_draft, blog_ideas) based on what the user wants done with the page.',
  inputSchema: z.object({
    urlOrId: z
      .string()
      .describe(
        'A Confluence page URL (https://yourorg.atlassian.net/wiki/spaces/KEY/pages/NNN/Title) or the raw numeric page ID.',
      ),
  }),
  execute: async ({ urlOrId }) => {
    const t0 = Date.now();
    console.log(`[read_confluence] start: ${urlOrId.slice(0, 80)}`);
    try {
      const page = await readConfluencePage(urlOrId);
      console.log(
        `[read_confluence] done in ${Date.now() - t0}ms (title=${JSON.stringify(page.title)}, ${page.charCount} chars)`,
      );
      return { success: true, ...page };
    } catch (e) {
      console.log(
        `[read_confluence] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `read_confluence failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
