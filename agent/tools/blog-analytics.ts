import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPostsByStatus } from '../lib/wordpress.js';
import {
  getPostPerformance,
  getReferrers,
  getSearchTerms,
  getSiteVisits,
  getTopPosts,
  resolvePostId,
  type PostPerformance,
} from '../lib/wp-stats.js';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RECENT_POSTS = 25;

/** Today in blog.postman.com's timezone (PT) as YYYY-MM-DD — Jetpack buckets days in site-local time. */
function todayPt(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}

function daysBetween(fromYmd: string, toYmd: string): number {
  return Math.max(1, Math.round((Date.parse(`${toYmd}T12:00:00Z`) - Date.parse(`${fromYmd}T12:00:00Z`)) / 86_400_000));
}

export const blogAnalyticsTool = createTool({
  id: 'blog_analytics',
  description:
    'Report traffic performance for blog.postman.com from WordPress (Jetpack) Stats. Read-only. Views = page loads, visitors = unique people. Pick a `view`: ' +
    '"site" — site-wide views + visitors per day/week/month, with the change vs the previous equal period; ' +
    '"top_posts" — most-viewed posts over the last N days (homepage and pages excluded); ' +
    '"post" — lifetime / last-7-day / last-30-day views for ONE post (pass its blog.postman.com URL or slug); ' +
    '"recent_posts" — how posts PUBLISHED between startDate and endDate performed, ranked by views (answers "how did last week\'s posts do?"); ' +
    '"referrers" — where traffic came from (search engines, social, etc.); ' +
    '"search_terms" — search queries that led to the blog (most are hidden by search engines, so this is a small sample). ' +
    'Stats are WordPress page-view counts, not Google Analytics — say so if the user asks about GA or conversions. Never invent numbers; if a call fails, report the error.',
  inputSchema: z.object({
    view: z.enum(['site', 'top_posts', 'post', 'recent_posts', 'referrers', 'search_terms']),
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe('Window ending at endDate, in days. Default 7. Used by site, top_posts, referrers, search_terms.'),
    unit: z.enum(['day', 'week', 'month']).optional().describe('site view only: bucket size. Default "day".'),
    limit: z.number().int().min(1).max(25).optional().describe('Max rows to return. Default 10.'),
    postUrl: z.string().optional().describe('post view: blog.postman.com URL or slug of the post.'),
    startDate: z.string().optional().describe('recent_posts view: inclusive publish-date start, YYYY-MM-DD.'),
    endDate: z.string().optional().describe('Inclusive end date YYYY-MM-DD. Default today (PT).'),
  }),
  execute: async ({ view, days = 7, unit = 'day', limit = 10, postUrl, startDate, endDate }) => {
    const t0 = Date.now();
    const end = endDate ?? todayPt();
    console.log(`[blog_analytics] start: view=${view} end=${end}`);
    if (!YMD_RE.test(end) || (startDate !== undefined && !YMD_RE.test(startDate))) {
      return { error: 'Dates must be YYYY-MM-DD.' };
    }

    try {
      switch (view) {
        case 'site': {
          // Fetch two windows' worth so the previous period can be compared.
          const points = await getSiteVisits(unit, days * 2, end);
          const current = points.slice(-days);
          const previous = points.slice(0, points.length - current.length);
          const sum = (ps: typeof points, k: 'views' | 'visitors') => ps.reduce((s, p) => s + p[k], 0);
          const views = sum(current, 'views');
          const prevViews = sum(previous, 'views');
          return {
            success: true,
            unit,
            periods: current,
            totals: { views, visitors: sum(current, 'visitors') },
            previousPeriod: { views: prevViews, visitors: sum(previous, 'visitors') },
            viewsChangePct: prevViews ? Math.round(((views - prevViews) / prevViews) * 1000) / 10 : null,
            note:
              'Visitors are summed per bucket, so a person active on several days counts more than once.' +
              (end === todayPt() ? ' The last bucket includes today, which is still a partial count.' : ''),
          };
        }
        case 'top_posts':
          return { success: true, days, endDate: end, posts: await getTopPosts(days, end, limit) };
        case 'referrers':
          return { success: true, days, endDate: end, sources: await getReferrers(days, end, limit) };
        case 'search_terms':
          return { success: true, days, endDate: end, ...(await getSearchTerms(days, end, limit)) };
        case 'post': {
          if (!postUrl) return { error: 'The post view needs postUrl (a blog.postman.com URL or slug).' };
          const id = await resolvePostId(postUrl);
          if (!id) return { error: `No published post found for "${postUrl}".` };
          return { success: true, post: await getPostPerformance(id) };
        }
        case 'recent_posts': {
          if (!startDate) return { error: 'The recent_posts view needs startDate (publish-date range start).' };
          const posts = await getPostsByStatus({ status: 'publish', afterYmd: startDate, beforeYmd: end, order: 'desc' });
          const capped = posts.slice(0, MAX_RECENT_POSTS);
          const today = todayPt();
          const results: Array<PostPerformance & { daysLive: number; avgViewsPerDay: number }> = [];
          const failed: string[] = [];
          for (let i = 0; i < capped.length; i += 5) {
            const batch = await Promise.allSettled(capped.slice(i, i + 5).map((p) => getPostPerformance(p.id)));
            batch.forEach((r, j) => {
              if (r.status === 'rejected') return void failed.push(capped[i + j].title);
              const daysLive = daysBetween(r.value.publishedYmd, today);
              results.push({ ...r.value, daysLive, avgViewsPerDay: Math.round(r.value.totalViews / daysLive) });
            });
          }
          results.sort((a, b) => b.totalViews - a.totalViews);
          console.log(`[blog_analytics] done in ${Date.now() - t0}ms (${results.length} posts)`);
          return {
            success: true,
            startDate,
            endDate: end,
            publishedCount: posts.length,
            analyzedCount: results.length,
            truncated: posts.length > capped.length,
            totalViews: results.reduce((s, p) => s + p.totalViews, 0),
            posts: results,
            ...(failed.length && { statsUnavailableFor: failed }),
            note: 'Newer posts have had fewer days to collect views — compare avgViewsPerDay, not totalViews, across posts of different age.',
          };
        }
      }
    } catch (e) {
      console.log(`[blog_analytics] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return { error: `blog_analytics failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  },
});
