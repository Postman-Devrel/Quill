import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createGoogleDoc } from '../lib/google-drive.js';

export const saveToGoogleDocTool = createTool({
  id: 'save_to_google_doc',
  description:
    'Save a markdown blog draft to Google Drive as a new Google Doc. Use this instead of save_to_confluence when the user asked for their draft in a Google Doc. Pass the suggested_title (or seoTitle for edits) and the FULL markdown including frontmatter. The doc is automatically shared as "anyone with the link can edit" so the requester can open it. Returns docUrl + docId + shared (whether that sharing succeeded) + shareWarning (if it failed).',
  inputSchema: z.object({
    title: z
      .string()
      .describe('Title for the Google Doc. Use suggested_title (first drafts) or seoTitle (edits).'),
    markdown: z
      .string()
      .describe('Full markdown content, including any YAML frontmatter.'),
    folderId: z
      .string()
      .optional()
      .describe('Optional, purely organizational — Drive folder to file the doc under. Defaults to GOOGLE_DRIVE_FOLDER_ID env var if set, otherwise the service account\'s own Drive root. Sharing does not depend on this.'),
  }),
  execute: async ({ title, markdown, folderId }) => {
    const t0 = Date.now();
    console.log(`[save_to_google_doc] start: title=${JSON.stringify(title)}`);
    try {
      const result = await createGoogleDoc({ title, markdown, folderId });
      console.log(`[save_to_google_doc] done in ${Date.now() - t0}ms (docId=${result.docId}, shared=${result.shared})`);
      return { success: true, ...result };
    } catch (e) {
      console.log(
        `[save_to_google_doc] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `save_to_google_doc failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
