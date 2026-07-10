import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, parseJsonResponse } from '../lib/anthropic.js';
import { getCopyeditSystemPrompt } from '../prompts/copyedit.js';

interface CopyeditResult {
  editedDraft: string;
  seoTitle: string;
  metaDescription: string;
  urlSlug: string;
  qualityScore: number;
  changes: string[];
  flags: string[];
}

function validateCopyeditResult(raw: unknown): CopyeditResult {
  const p = raw as Partial<CopyeditResult>;
  if (
    typeof p.editedDraft !== 'string' ||
    typeof p.seoTitle !== 'string' ||
    typeof p.metaDescription !== 'string' ||
    !Array.isArray(p.changes)
  ) {
    throw new Error('Copyedit response was missing required fields.');
  }
  return {
    editedDraft: p.editedDraft,
    seoTitle: p.seoTitle,
    metaDescription: p.metaDescription,
    urlSlug: typeof p.urlSlug === 'string' ? p.urlSlug : '',
    qualityScore: typeof p.qualityScore === 'number' ? p.qualityScore : 0,
    changes: p.changes.map((c) => String(c)),
    flags: Array.isArray(p.flags) ? p.flags.map((f) => String(f)) : [],
  };
}

export const copyeditDraftTool = createTool({
  id: 'copyedit_draft',
  description:
    'Copy edit a blog draft for grammar, repetitive structure, Postman style guide compliance (branded terms, prohibited words, inclusive language), and SEO. Returns the fully edited markdown plus the optimized SEO title, 150-char meta description, URL slug, a quality score 1-10, a list of auto-applied changes, and a list of flags (risky rewrites the writer should review — sentence length, paragraph length, voice imbalance, weak titles). Surface flags to the user; they are suggestions, not applied edits. Use this AFTER write_draft when the user asks to copy-edit, polish, or finalize a draft. Takes ~30 seconds.',
  inputSchema: z.object({
    markdown: z
      .string()
      .describe(
        'Full markdown of the blog draft to copy-edit, including the YAML frontmatter at the top.',
      ),
  }),
  execute: async ({ markdown }) => {
    const t0 = Date.now();
    console.log(`[copyedit_draft] start: ${markdown.length} chars`);
    const userPrompt = `Copy-edit the following blog post. Apply all corrections directly and return the JSON object described in the system prompt.\n\n---\n\n${markdown}`;

    try {
      const raw = await generateText({
        systemPrompt: await getCopyeditSystemPrompt(),
        userPrompt,
        maxTokens: 5000,
      });
      const result = validateCopyeditResult(parseJsonResponse(raw));
      console.log(`[copyedit_draft] done in ${Date.now() - t0}ms (quality=${result.qualityScore}, ${result.changes.length} changes, ${result.flags.length} flags)`);
      return {
        success: true,
        ...result,
      };
    } catch (e) {
      console.log(`[copyedit_draft] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `copyedit_draft failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
