import { createConfluencePage } from '../lib/confluence.js';
import { draftVideoBlog } from './draft.js';
import { getTranscript } from './transcript.js';

export interface VideoBlogArgs { url?: string; transcript?: string; title?: string; audience: string; angle?: string }

/**
 * Transcript → Claude article → Confluence page, all in one call so the user gets a link
 * without having to ask again. If Confluence fails the draft is still returned, not lost.
 */
export async function videoToBlog(args: VideoBlogArgs, deps = { getTranscript, draft: draftVideoBlog, save: createConfluencePage }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required to write the article.');
  const transcript = await deps.getTranscript(args);
  const article = await deps.draft(transcript, args.audience, args.angle);
  const base = { title: article.title, source: transcript.source, reviewNotes: article.reviewNotes, transcriptChars: transcript.text.length };
  try {
    const page = await deps.save({ title: article.title, markdown: article.draft });
    return { success: true as const, ...base, pageUrl: page.pageUrl, pageId: page.pageId };
  } catch (e) {
    return { success: false as const, ...base, saveError: e instanceof Error ? e.message : String(e), draft: article.draft };
  }
}
