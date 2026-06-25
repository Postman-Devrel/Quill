import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPostsByStatus } from '../lib/wordpress.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function dayNameFromYmd(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return DAY_NAMES[d.getUTCDay()];
}

function monthLabel(ymd: string): string {
  const year = ymd.slice(0, 4);
  const month0 = Number(ymd.slice(5, 7)) - 1;
  return `${MONTH_LABELS[month0]} ${year}`;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export const wpPublishStatsTool = createTool({
  id: 'wp_publish_stats',
  description:
    'Count how many posts were published on blog.postman.com between two dates. Returns the total, a per-post listing (date, day of week, title, link), and a monthly breakdown. Use this when the user asks "how many posts did we publish in X?", "show me Q1 publishing", or wants any historical publish-count breakdown. For current-year per-month counts including drafts/scheduled, use list_wp_schedule with view="summary" instead.',
  inputSchema: z.object({
    startDate: z.string().describe('Inclusive start date YYYY-MM-DD'),
    endDate: z.string().describe('Inclusive end date YYYY-MM-DD'),
  }),
  execute: async ({ startDate, endDate }) => {
    const t0 = Date.now();
    console.log(`[wp_publish_stats] start: ${startDate} → ${endDate}`);
    if (!YMD_RE.test(startDate) || !YMD_RE.test(endDate)) {
      return { error: `Dates must be YYYY-MM-DD format. Got "${startDate}" and "${endDate}".` };
    }
    if (startDate > endDate) {
      return { error: `startDate ${startDate} is after endDate ${endDate}.` };
    }

    try {
      const posts = await getPostsByStatus({
        status: 'publish',
        afterYmd: startDate,
        beforeYmd: endDate,
        order: 'asc',
      });

      const byMonthMap = new Map<string, number>();
      const listing = posts.map((p) => {
        const label = monthLabel(p.ymd);
        byMonthMap.set(label, (byMonthMap.get(label) ?? 0) + 1);
        return {
          id: p.id,
          ymd: p.ymd,
          dayOfWeek: dayNameFromYmd(p.ymd),
          title: p.title,
          link: p.link,
        };
      });

      // Preserve chronological order of months as they first appear
      const byMonth = Array.from(byMonthMap.entries()).map(([month, count]) => ({
        month,
        count,
      }));

      console.log(`[wp_publish_stats] done in ${Date.now() - t0}ms (${posts.length} posts)`);
      return {
        success: true,
        startDate,
        endDate,
        total: posts.length,
        posts: listing,
        byMonth,
      };
    } catch (e) {
      console.log(`[wp_publish_stats] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `wp_publish_stats failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
