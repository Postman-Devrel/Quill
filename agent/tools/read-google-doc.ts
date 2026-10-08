import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { readGoogleDoc } from '../lib/google-drive.js';

export const readGoogleDocTool = createTool({
  id: 'read_google_doc',
  description:
    'Read a Google Doc and return its contents as markdown. ALWAYS call this FIRST when the user pastes a Google Docs/Drive URL — the markdown output then feeds into the appropriate next tool (copyedit_draft, write_draft, blog_ideas, stage_to_wordpress) based on what the user wants done with the doc. Uses the configured Google service account and Drive API. Share private documents or their parent folder with the service-account email as Viewer; public link sharing is not required. Supports Google Docs only.',
  inputSchema: z.object({
    url: z
      .string()
      .describe('A Google Docs or Drive URL (e.g. https://docs.google.com/document/d/1abc.../edit), or the raw document ID.'),
  }),
  execute: async ({ url }) => {
    const t0 = Date.now();
    console.log(`[read_google_doc] start: ${url.slice(0, 80)}`);
    try {
      const doc = await readGoogleDoc(url);
      console.log(
        `[read_google_doc] done in ${Date.now() - t0}ms (title=${JSON.stringify(doc.title)}, ${doc.charCount} chars)`,
      );
      return { success: true, ...doc };
    } catch (e) {
      console.log(
        `[read_google_doc] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `read_google_doc failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
