import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { MAX_TRANSCRIPT_CHARS } from '../video/transcript.js';
import { videoToBlog } from '../video/pipeline.js';

export const videoToBlogTool = createTool({
  id: 'video_to_blog',
  description: 'Turn a video transcript into an SEO/AEO blog and save it to Confluence, all in one call (takes about a minute). Provide a public YouTube URL (uses its captions), a Loom share URL (uses its transcript), or a pasted transcript. Only spoken words are used; nothing on screen is analyzed. Returns the Confluence pageUrl and review notes. If fetching the transcript fails (no captions, private Loom), the error says so; ask the user to paste the transcript. Do not call save_to_confluence afterwards: this tool already saved the draft.',
  inputSchema: z.object({
    url: z.string().max(2000).optional(), transcript: z.string().max(MAX_TRANSCRIPT_CHARS).optional(), title: z.string().max(300).optional(),
    audience: z.string().min(1).max(500).default('API developers'), angle: z.string().max(2000).optional(),
  }).refine(v => Boolean(v.url?.trim()) || Boolean(v.transcript?.trim()), 'Provide a YouTube/Loom URL or a pasted transcript.'),
  execute: async (args) => {
    const t0 = Date.now();
    console.log(`[video_to_blog] start: ${args.url ?? 'pasted transcript'}`);
    try {
      const result = await videoToBlog(args);
      console.log(`[video_to_blog] done in ${Date.now() - t0}ms (saved=${result.success}${result.success ? '' : `, saveError=${result.saveError}`})`);
      return result;
    } catch (e) {
      console.log(`[video_to_blog] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return { error: e instanceof Error ? e.message : 'Could not turn the video into a blog.' };
    }
  },
});
