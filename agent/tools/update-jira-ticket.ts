import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { updateJiraIssue } from '../lib/jira.js';

export const updateJiraTicketTool = createTool({
  id: 'update_jira_ticket',
  description:
    'Edit an existing Jira ticket — update the author, summary, Confluence draft link, due date, assignee, labels, or add a comment. Use this when the user asks to fix, update, or change anything on a ticket they already have (e.g. "update MKTG-10629 with Sam Chehab as the author"). Always confirm the issue key before calling.',
  inputSchema: z.object({
    issueKey: z
      .string()
      .describe('The Jira issue key to update, e.g. "MKTG-10629".'),
    summary: z
      .string()
      .optional()
      .describe('New summary/title for the ticket. Leave unset to keep the existing summary.'),
    author: z
      .string()
      .optional()
      .describe('Full name of the blog post author to set in the description, e.g. "Sam Chehab".'),
    confluenceUrl: z
      .string()
      .optional()
      .describe('Updated Confluence draft URL to set in the description.'),
    dueDate: z
      .string()
      .optional()
      .describe('New due date in YYYY-MM-DD format.'),
    assigneeAccountId: z
      .string()
      .optional()
      .describe('Atlassian account ID of the new assignee.'),
    labels: z
      .array(z.string())
      .optional()
      .describe('Replacement label list. Replaces all existing labels.'),
    comment: z
      .string()
      .optional()
      .describe('A comment to add to the ticket (plain text).'),
  }),
  execute: async ({ issueKey, summary, author, confluenceUrl, dueDate, assigneeAccountId, labels, comment }) => {
    const t0 = Date.now();
    console.log(`[update_jira_ticket] start: key=${issueKey}`);
    try {
      const result = await updateJiraIssue({
        issueKey,
        summary,
        author,
        confluenceUrl,
        dueDate,
        assigneeAccountId,
        labels,
        comment,
      });
      console.log(`[update_jira_ticket] done in ${Date.now() - t0}ms (key=${result.key})`);
      return {
        success: true,
        ticketKey: result.key,
        ticketUrl: result.ticketUrl,
        identity: result.identity,
      };
    } catch (e) {
      console.log(
        `[update_jira_ticket] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      return {
        error: `update_jira_ticket failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
