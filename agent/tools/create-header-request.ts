import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createHeaderRequestIssue } from '../lib/jira.js';

export const createHeaderRequestTool = createTool({
  id: 'create_header_request',
  description:
    'Create a Jira ticket requesting a header image for a blog. ALWAYS call this immediately after save_to_confluence succeeds — the ticket links back to the freshly-created Confluence page so the designer can read the draft and produce a matching image. Pass the blog title (from the draft frontmatter) and the Confluence page URL returned by save_to_confluence.',
  inputSchema: z.object({
    blogTitle: z
      .string()
      .describe('The blog title (usually suggested_title from the draft frontmatter, or seoTitle after copyedit).'),
    confluenceUrl: z
      .string()
      .describe('The Confluence page URL returned by save_to_confluence — designers open this to see the draft.'),
    projectKey: z
      .string()
      .optional()
      .describe('Jira project key. Defaults to JIRA_PROJECT_KEY env var, or "MKTG" if unset.'),
    issueType: z
      .string()
      .optional()
      .describe('Jira issue type. Defaults to JIRA_HEADER_ISSUE_TYPE env var, or "Task" if unset.'),
    marketingTeam: z
      .string()
      .optional()
      .describe('Marketing Team option (MKTG required field). Defaults to JIRA_MARKETING_TEAM env var, or "Creative" if unset.'),
  }),
  execute: async ({ blogTitle, confluenceUrl, projectKey, issueType, marketingTeam }) => {
    const t0 = Date.now();
    console.log(`[create_header_request] start: title=${JSON.stringify(blogTitle)}`);
    try {
      const result = await createHeaderRequestIssue({
        blogTitle,
        confluenceUrl,
        projectKey,
        issueType,
        marketingTeam,
      });
      console.log(
        `[create_header_request] done in ${Date.now() - t0}ms (key=${result.key})`,
      );
      return {
        success: true,
        ticketKey: result.key,
        ticketUrl: result.ticketUrl,
        summary: result.summary,
        projectKey: result.projectKey,
        issueType: result.issueType,
        identity: result.identity,
      };
    } catch (e) {
      console.log(
        `[create_header_request] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `create_header_request failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
