import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { generateText, parseJsonResponse } from '../lib/anthropic.js';
import YAML from 'yaml';
import {
  getCopyeditSystemPrompt,
  getGrammarSystemPrompt,
  getSeoMetadataSystemPrompt,
} from '../prompts/copyedit.js';
import { parseFrontmatter, frontmatterString } from '../lib/markdown.js';

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

const MODES = ['full', 'grammar', 'seo_only'] as const;
type CopyeditMode = (typeof MODES)[number];

/** Grammar-only: model returns the lightly-fixed draft; metadata comes from existing frontmatter. */
async function runGrammar(markdown: string, maxTokens: number) {
  const raw = await generateText({
    systemPrompt: getGrammarSystemPrompt(),
    userPrompt: `Proofread the following blog post. Fix only objective grammar, spelling, and punctuation errors. Return the JSON object described in the system prompt.\n\n---\n\n${markdown}`,
    maxTokens,
  });
  const p = parseJsonResponse(raw) as { editedDraft?: unknown; changes?: unknown; flags?: unknown };
  if (typeof p.editedDraft !== 'string' || !Array.isArray(p.changes)) {
    throw new Error('Grammar response was missing required fields.');
  }
  const { frontmatter } = parseFrontmatter(markdown);
  return {
    editedDraft: p.editedDraft,
    seoTitle: frontmatterString(frontmatter, 'suggested_title') ?? '',
    metaDescription: frontmatterString(frontmatter, 'meta_description') ?? '',
    urlSlug: '',
    qualityScore: 0,
    changes: p.changes.map((c) => String(c)),
    flags: Array.isArray(p.flags) ? p.flags.map((f) => String(f)) : [],
  } satisfies CopyeditResult;
}

/** SEO/AEO only: the model sees the post but only returns metadata; the body is never rewritten. */
async function runSeoOnly(markdown: string) {
  const raw = await generateText({
    systemPrompt: getSeoMetadataSystemPrompt(),
    userPrompt: `Generate SEO and AEO metadata for the following blog post. Do not rewrite it.\n\n---\n\n${markdown}`,
    maxTokens: 2000,
  });
  const p = parseJsonResponse(raw) as Record<string, unknown>;
  if (typeof p.seoTitle !== 'string' || typeof p.metaDescription !== 'string') {
    throw new Error('SEO response was missing required fields.');
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

  // Merge into existing frontmatter; every non-SEO key (author, wordpress_id, ...) is preserved.
  const { frontmatter, body } = parseFrontmatter(markdown);
  const merged: Record<string, unknown> = {
    ...frontmatter,
    suggested_title: p.seoTitle,
    meta_description: p.metaDescription,
    primary_keyword: str(p.primaryKeyword) || frontmatter.primary_keyword,
    secondary_keywords: list(p.secondaryKeywords),
    url_slug: str(p.urlSlug),
    answer_summary: str(p.answerSummary),
  };
  const editedDraft = `---\n${YAML.stringify(merged)}---\n\n${body}\n`;
  return {
    editedDraft,
    seoTitle: p.seoTitle,
    metaDescription: p.metaDescription,
    urlSlug: str(p.urlSlug),
    qualityScore: 0,
    changes: [
      'Added SEO title, meta description, URL slug, primary/secondary keywords, and an AEO answer summary to the frontmatter. Body untouched.',
    ],
    flags: list(p.flags),
  } satisfies CopyeditResult;
}

export const copyeditDraftTool = createTool({
  id: 'copyedit_draft',
  description:
    'Copy edit a blog draft. Has three modes; ALWAYS ask the user which one they want before calling (see the copy-edit workflow). mode="full" (default): grammar, repetitive structure, Postman style guide compliance, humanizer pass, SEO, and a Resources section; rewrites prose. mode="grammar": proofread only, fixes spelling/grammar/punctuation and leaves voice, wording, and structure alone. mode="seo_only": the body is NEVER rewritten; only adds SEO/AEO frontmatter (title, meta description, slug, keywords, answer_summary) and returns AEO suggestions as flags. Full-mode description follows. Copy edit a blog draft for grammar, repetitive structure, Postman style guide compliance (branded terms, prohibited words, inclusive language), and SEO. Returns the fully edited markdown plus the optimized SEO title, 150-char meta description, URL slug, a quality score 1-10, a list of auto-applied changes, and a list of flags (risky rewrites the writer should review — sentence length, paragraph length, voice imbalance, weak titles). Surface flags to the user; they are suggestions, not applied edits. Use this AFTER write_draft when the user asks to copy-edit, polish, or finalize a draft. Handles drafts up to ~15,000 words (typical 1,200–1,600); long pieces take longer than 30 seconds.',
  inputSchema: z.object({
    markdown: z
      .string()
      .describe(
        'Full markdown of the blog draft to copy-edit, including the YAML frontmatter at the top.',
      ),
    mode: z
      .enum(MODES)
      .default('full')
      .describe(
        'full = complete copy-edit + SEO (rewrites prose). grammar = proofread only, voice untouched. seo_only = add SEO/AEO frontmatter, body untouched.',
      ),
  }),
  execute: async ({ markdown, mode }) => {
    const t0 = Date.now();
    console.log(`[copyedit_draft] start: mode=${mode} ${markdown.length} chars`);
    const userPrompt = `Copy-edit the following blog post. Apply all corrections directly and return the JSON object described in the system prompt.\n\nIMPORTANT: The editedDraft MUST end with a "## Resources" section listing 3–6 real, verifiable URLs relevant to the topic. If the draft already has one, keep and improve it. If it is missing, add it.\n\n---\n\n${markdown}`;

    try {
      // Sized for drafts up to ~15K words (~20K tokens) plus JSON wrapper/escaping.
      const maxTokens = 32000;
      let result: CopyeditResult;
      if (mode === 'grammar') {
        result = await runGrammar(markdown, maxTokens);
      } else if (mode === 'seo_only') {
        result = await runSeoOnly(markdown);
      } else {
        const raw = await generateText({
          systemPrompt: await getCopyeditSystemPrompt(),
          userPrompt,
          maxTokens,
        });
        result = validateCopyeditResult(parseJsonResponse(raw));
      }
      console.log(`[copyedit_draft] done in ${Date.now() - t0}ms (quality=${result.qualityScore}, ${result.changes.length} changes, ${result.flags.length} flags)`);
      return {
        success: true,
        mode,
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
