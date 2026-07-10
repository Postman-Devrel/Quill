import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  parseFrontmatter,
  markdownToHtml,
  frontmatterString,
  frontmatterStringArray,
} from '../lib/markdown.js';
import {
  findOrCreateTags,
  findPostByExactTitle,
  findWpUserByName,
  createOrUpdatePost,
} from '../lib/wordpress.js';

export const stageToWordPressTool = createTool({
  id: 'stage_to_wordpress',
  description:
    'Stage a blog draft to blog.postman.com WordPress as a draft post. Pass the FULL markdown including YAML frontmatter — the tool extracts title, meta description, primary keyword, and tags from the frontmatter automatically. Tags are looked up or created in WordPress as needed. If a post with the same title already exists, it is UPDATED rather than duplicated. Always saves as status=draft (never publishes). Returns post ID, edit URL, and preview URL.',
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
        'Optional explicit tag list. Defaults to primary_keyword + secondary_keywords from frontmatter. Max 5 tags.',
      ),
    authorName: z
      .string()
      .optional()
      .describe('Author name or WordPress login slug to attribute the post to. If provided, the tool looks up the matching WP user ID. Always ask the user who the author should be before staging.'),
  }),
  execute: async ({ markdown, titleOverride, metaDescriptionOverride, tagsOverride, authorName }) => {
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

      const defaultTags = [
        ...(focusKeyphrase ? [focusKeyphrase] : []),
        ...frontmatterStringArray(frontmatter, 'secondary_keywords'),
      ];
      const tagNames = (tagsOverride ?? defaultTags).filter(Boolean).slice(0, 5);

      // Step 2 — markdown body to HTML
      const htmlContent = await markdownToHtml(body);

      // Step 3 — resolve tags
      const resolvedTags = tagNames.length > 0 ? await findOrCreateTags(tagNames) : [];
      const tagIds = resolvedTags.map((t) => t.id);

      // Step 4 — resolve author (optional)
      let authorId: number | undefined;
      let resolvedAuthor: string | undefined;
      if (authorName) {
        const user = await findWpUserByName(authorName);
        if (user) {
          authorId = user.id;
          resolvedAuthor = user.name;
        }
      }

      // Step 5 — check for an existing post with this title to avoid duplication
      const existing = await findPostByExactTitle(title);

      // Step 6 — create or update
      const post = await createOrUpdatePost({
        title,
        htmlContent,
        metaDescription,
        focusKeyphrase: focusKeyphrase || undefined,
        tagIds: tagIds.length > 0 ? tagIds : undefined,
        postId: existing?.id,
        authorId,
      });

      console.log(`[stage_to_wordpress] done in ${Date.now() - t0}ms (${existing ? 'updated' : 'created'} #${post.id}${authorId ? ` author=${authorId}` : ''})`);
      return {
        success: true,
        action: existing ? 'updated' : 'created',
        postId: post.id,
        title: post.title,
        status: post.status,
        editUrl: post.editLink,
        previewUrl: post.link,
        tags: resolvedTags,
        author: resolvedAuthor ?? null,
      };
    } catch (e) {
      console.log(`[stage_to_wordpress] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `stage_to_wordpress failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
