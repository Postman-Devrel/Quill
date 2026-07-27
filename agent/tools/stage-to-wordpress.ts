import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  parseFrontmatter,
  markdownToHtml,
  stripLeadingH1,
  frontmatterString,
  frontmatterStringArray,
  frontmatterNumber,
} from '../lib/markdown.js';
import {
  findOrCreateTags,
  findPostByExactTitle,
  findWpUserByName,
  createOrUpdatePost,
} from '../lib/wordpress.js';
import { moveJiraIssueToStatus } from '../lib/jira.js';

export const stageToWordPressTool = createTool({
  id: 'stage_to_wordpress',
  description:
    'Stage a blog draft to blog.postman.com WordPress as a draft post. Pass the FULL markdown including YAML frontmatter — the tool extracts title, meta description, primary keyword, and tags from the frontmatter automatically. Up to 3 tags are looked up or created in WordPress. To match a post reliably on re-runs, resolution order is: postId argument → wordpress_id in frontmatter → exact-title search; an existing post is UPDATED rather than duplicated. ALWAYS saves as status=draft — Quill never schedules (status=future) or publishes (status=publish); a human editor does that in WP admin. If you pass jiraKey (the blog content ticket for this post), the ticket is moved to "In Review" after staging. Returns post ID, edit URL, and preview URL.',
  inputSchema: z.object({
    markdown: z
      .string()
      .describe('Full markdown of the blog draft including YAML frontmatter.'),
    titleOverride: z
      .string()
      .optional()
      .describe('Optional title override. Defaults to suggested_title from frontmatter.'),
    metaDescriptionOverride: z
      .string()
      .optional()
      .describe('Optional meta description override. Defaults to meta_description from frontmatter.'),
    tagsOverride: z
      .array(z.string())
      .optional()
      .describe(
        'Optional explicit tag list. Defaults to primary_keyword + secondary_keywords from frontmatter. Max 3 tags — pick specific, useful topics (e.g. "OAuth 2.0", "API Testing"), not generic ones like "Postman".',
      ),
    postId: z
      .number()
      .int()
      .optional()
      .describe('Optional WordPress post ID to update directly. Overrides the wordpress_id frontmatter field and the title search. Use when you already know the post to update.'),
    jiraKey: z
      .string()
      .optional()
      .describe('Optional Jira ticket key for this blog (e.g. MKTG-12345), from the blog content ticket created after drafting. When provided, the ticket is moved to "In Review" after the draft is staged. Pass the key from earlier in the conversation.'),
    authorName: z
      .string()
      .optional()
      .describe('Author name or WordPress login slug to attribute the post to. If provided, the tool looks up the matching WP user ID. Always ask the user who the author should be before staging.'),
  }),
  execute: async ({ markdown, titleOverride, metaDescriptionOverride, tagsOverride, postId, jiraKey, authorName }) => {
    const t0 = Date.now();
    console.log(`[stage_to_wordpress] start: ${markdown.length} chars`);
    try {
      // Step 1 — parse frontmatter
      const { frontmatter, body } = parseFrontmatter(markdown);

      const title =
        titleOverride ?? frontmatterString(frontmatter, 'suggested_title');
      const metaDescription =
        metaDescriptionOverride ?? frontmatterString(frontmatter, 'meta_description');
      const focusKeyphrase = frontmatterString(frontmatter, 'primary_keyword');

      if (!title) {
        return {
          error:
            'No title found. Provide titleOverride or include suggested_title in the frontmatter.',
        };
      }

      // A missing meta description hurts SEO — surface it rather than staging silently.
      const metaWarning =
        metaDescription.trim() === ''
          ? 'No meta_description found in the frontmatter and none was provided. Staged without a Yoast meta description — generate one (<155 chars, active voice, includes the primary keyword) and re-stage with metaDescriptionOverride.'
          : undefined;

      const defaultTags = [
        ...(focusKeyphrase ? [focusKeyphrase] : []),
        ...frontmatterStringArray(frontmatter, 'secondary_keywords'),
      ];
      // Max 3 tags to keep posts focused (matches blog-wordpress-stage).
      const tagNames = (tagsOverride ?? defaultTags).filter(Boolean).slice(0, 3);

      // Step 2 — markdown body to HTML. Strip the leading H1 first so the title
      // isn't duplicated in the WordPress body (WP renders the title field).
      const htmlContent = await markdownToHtml(stripLeadingH1(body));

      // Step 3 — resolve tags
      const resolvedTags = tagNames.length > 0 ? await findOrCreateTags(tagNames) : [];
      const tagIds = resolvedTags.map((t) => t.id);

      // Step 4 — resolve author (optional). Lookup uses context=view so it works
      // for non-admin accounts too; assigning ANOTHER user still needs the
      // edit_others_posts capability, handled resiliently in Step 6.
      let authorId: number | undefined;
      let resolvedAuthor: string | undefined;
      let authorWarning: string | undefined;
      if (authorName) {
        try {
          const user = await findWpUserByName(authorName);
          if (user) {
            authorId = user.id;
            resolvedAuthor = user.name;
          } else {
            authorWarning = `No WordPress user matched "${authorName}" — staged without an author override. Set it manually in WP admin.`;
          }
        } catch (e) {
          authorWarning = `Couldn't look up author "${authorName}" (${e instanceof Error ? e.message : String(e)}) — the staging account may lack permission to list users. Staged without an author override.`;
        }
      }

      // Step 5 — resolve which post to update, most reliable first:
      //   explicit postId arg → wordpress_id in frontmatter → exact-title search.
      const frontmatterWpId = frontmatterNumber(frontmatter, 'wordpress_id');
      let targetPostId = postId ?? frontmatterWpId;
      let matchedBy: 'postId' | 'wordpress_id' | 'title' | null =
        postId !== undefined ? 'postId' : frontmatterWpId !== undefined ? 'wordpress_id' : null;
      if (targetPostId === undefined) {
        const existing = await findPostByExactTitle(title);
        if (existing) {
          targetPostId = existing.id;
          matchedBy = 'title';
        }
      }

      // Step 6 — create or update. Author assignment is best-effort: if the
      // account can't set another user as author, retry without it so the draft
      // still stages, then warn.
      const baseParams = {
        title,
        htmlContent,
        metaDescription,
        focusKeyphrase: focusKeyphrase || undefined,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        postId: targetPostId,
      };
      let post: Awaited<ReturnType<typeof createOrUpdatePost>>;
      try {
        post = await createOrUpdatePost({ ...baseParams, authorId });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (authorId !== undefined && /author|rest_cannot_edit_others/i.test(msg)) {
          // Author rejected — stage without it rather than failing the whole post.
          post = await createOrUpdatePost({ ...baseParams, authorId: undefined });
          authorWarning = `Staged, but couldn't set the author to "${resolvedAuthor}" — the WP account lacks permission to assign another user (needs Editor/Admin). Set it manually in WP admin.`;
          resolvedAuthor = undefined;
        } else {
          throw e;
        }
      }

      // Confirm the author actually stuck (WP can accept the request but keep the
      // original author when the account lacks edit_others_posts).
      if (authorId !== undefined && post.authorId !== authorId) {
        authorWarning = `Requested author "${resolvedAuthor ?? authorName}" (id ${authorId}) but WordPress saved it under user id ${post.authorId} — the staging account likely can't reassign authors (needs Editor/Admin).`;
        resolvedAuthor = undefined;
      }

      const action = targetPostId !== undefined ? 'updated' : 'created';

      // Staging a draft signals the blog is ready for review — move the linked
      // Jira ticket from "In Progress" to "In Review". Best-effort: never fails
      // the stage. The WP post is still draft-only; this only changes Jira.
      let jiraMove: { key: string; status: string | null; moved: boolean; ticketUrl: string } | undefined;
      if (jiraKey) {
        try {
          jiraMove = await moveJiraIssueToStatus(jiraKey, 'In Review');
        } catch (e) {
          jiraMove = { key: jiraKey, status: null, moved: false, ticketUrl: '' };
          console.log(`[stage_to_wordpress] jira move error: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      console.log(`[stage_to_wordpress] done in ${Date.now() - t0}ms (${action} #${post.id} via ${matchedBy ?? 'new'} author=${post.authorId}${authorWarning ? ' [author-warning]' : ''}${jiraKey ? ` jira=${jiraKey}:${jiraMove?.moved ? 'In Review' : 'move-failed'}` : ''})`);
      return {
        success: true,
        action,
        matchedBy,
        postId: post.id,
        title: post.title,
        status: post.status,
        editUrl: post.editLink,
        previewUrl: post.link,
        tags: resolvedTags,
        author: resolvedAuthor ?? null,
        authorId: post.authorId,
        ...(jiraKey
          ? {
              jiraTicket: jiraKey,
              jiraMovedToInReview: Boolean(jiraMove?.moved),
              ...(jiraMove && !jiraMove.moved
                ? { jiraWarning: `Staged the draft, but couldn't move ${jiraKey} to "In Review" automatically — move it manually on the board.` }
                : {}),
            }
          : {}),
        ...(authorWarning ? { authorWarning } : {}),
        ...(metaWarning ? { warning: metaWarning } : {}),
      };
    } catch (e) {
      console.log(`[stage_to_wordpress] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `stage_to_wordpress failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
