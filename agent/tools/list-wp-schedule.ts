import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPostsByStatus, getScheduledPosts } from '../lib/wordpress.js';
import { findOpenSlots, addDays, toYMD } from '../lib/scheduling.js';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayNameFromYmd(ymd: string): string {
  // Build at 12:00 UTC to avoid any DST boundary weirdness near midnight
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return DAY_NAMES[d.getUTCDay()];
}

function monthNumberFromYmd(ymd: string): number {
  return Number(ymd.slice(5, 7));
}
function yearFromYmd(ymd: string): number {
  return Number(ymd.slice(0, 4));
}

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const listWpScheduleTool = createTool({
  id: 'list_wp_schedule',
  description:
    'Show the blog.postman.com editorial calendar. Three views: "upcoming" (default — next N weeks of scheduled posts + recent drafts + next open slots), "monthly" (per-month published/scheduled counts for a year, plus a detailed list for the current month), and "summary" (YTD grid of published/draft/scheduled/total per month). Use "upcoming" when the user asks what is scheduled, what is queued up, or what is coming next. Use "monthly" for a per-month breakdown. Use "summary" for a YTD overview.',
  inputSchema: z.object({
    view: z
      .enum(['upcoming', 'monthly', 'summary'])
      .optional()
      .describe('Which view to return. Defaults to "upcoming".'),
    weeks: z
      .number()
      .int()
      .min(1)
      .max(26)
      .optional()
      .describe('For "upcoming" view: how many weeks ahead to show. Defaults to 8.'),
    year: z
      .number()
      .int()
      .optional()
      .describe('For "monthly" and "summary" views: which year. Defaults to current year.'),
  }),
  execute: async ({ view, weeks, year }) => {
    const t0 = Date.now();
    const which = view ?? 'upcoming';
    const yr = year ?? new Date().getUTCFullYear();
    console.log(`[list_wp_schedule] start: view=${which} weeks=${weeks ?? '-'} year=${yr}`);
    try {
      let result;
      if (which === 'upcoming') {
        result = await buildUpcomingView(weeks ?? 8);
      } else if (which === 'monthly') {
        result = await buildMonthlyView(yr);
      } else {
        result = await buildSummaryView(yr);
      }
      console.log(`[list_wp_schedule] done in ${Date.now() - t0}ms`);
      return result;
    } catch (e) {
      console.log(`[list_wp_schedule] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `list_wp_schedule failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});

// The blog-wordpress-scheduler "list" view has three sections with these windows.
const RECENTLY_PUBLISHED_DAYS = 180; // past 6 months
const RECENT_DRAFTS_DAYS = 21; // past 3 weeks
const RECENTLY_PUBLISHED_RETURN_CAP = 15; // keep the payload Slack-friendly

async function buildUpcomingView(weeks: number) {
  const today = new Date();
  const endYmd = toYMD(addDays(today, weeks * 7));
  const publishedAfterYmd = toYMD(addDays(today, -RECENTLY_PUBLISHED_DAYS));
  const draftsAfterYmd = toYMD(addDays(today, -RECENT_DRAFTS_DAYS));

  const [scheduled, published, drafts] = await Promise.all([
    getScheduledPosts(),
    getPostsByStatus({ status: 'publish', afterYmd: publishedAfterYmd, order: 'desc' }),
    getPostsByStatus({
      status: 'draft',
      afterYmd: draftsAfterYmd,
      orderBy: 'modified',
      order: 'desc',
    }),
  ]);

  const inWindow = scheduled.filter((p) => p.ymd <= endYmd);

  const scheduledDates = new Set(scheduled.map((p) => p.ymd));
  const nextOpenSlots = findOpenSlots({ count: 3, scheduledDates });

  return {
    view: 'upcoming',
    weeksAhead: weeks,
    upcoming: inWindow.map((p) => ({
      id: p.id,
      title: p.title,
      ymd: p.ymd,
      dayOfWeek: dayNameFromYmd(p.ymd),
      previewUrl: p.link,
    })),
    recentlyPublished: {
      window: 'past 6 months',
      total: published.length,
      posts: published.slice(0, RECENTLY_PUBLISHED_RETURN_CAP).map((p) => ({
        id: p.id,
        title: p.title,
        ymd: p.ymd,
        dayOfWeek: dayNameFromYmd(p.ymd),
        link: p.link,
      })),
    },
    recentDrafts: drafts.map((p) => ({
      id: p.id,
      title: p.title,
      ymd: p.ymd,
      modifiedYmd: p.modifiedYmd,
      dayOfWeek: dayNameFromYmd(p.modifiedYmd),
    })),
    nextOpenSlots: nextOpenSlots.map((ymd) => ({
      ymd,
      dayOfWeek: dayNameFromYmd(ymd),
    })),
  };
}

async function buildMonthlyView(year: number) {
  const startYmd = `${year}-01-01`;
  const endYmd = `${year}-12-31`;

  const [published, scheduled] = await Promise.all([
    getPostsByStatus({ status: 'publish', afterYmd: startYmd, beforeYmd: endYmd }),
    getPostsByStatus({ status: 'future', afterYmd: startYmd, beforeYmd: endYmd }),
  ]);

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: MONTH_LABELS[i],
    published: 0,
    scheduled: 0,
    total: 0,
  }));

  for (const p of published) {
    if (yearFromYmd(p.ymd) === year) months[monthNumberFromYmd(p.ymd) - 1].published++;
  }
  for (const p of scheduled) {
    if (yearFromYmd(p.ymd) === year) months[monthNumberFromYmd(p.ymd) - 1].scheduled++;
  }
  for (const m of months) m.total = m.published + m.scheduled;

  // Current-month detail
  const now = new Date();
  const currentMonth0 = now.getUTCFullYear() === year ? now.getUTCMonth() : -1;
  let currentMonthPosts: Array<{
    id: number;
    title: string;
    ymd: string;
    dayOfWeek: string;
    status: string;
  }> = [];
  if (currentMonth0 >= 0) {
    const mm = String(currentMonth0 + 1).padStart(2, '0');
    const monthPrefix = `${year}-${mm}-`;
    const filterByMonth = (arr: typeof published, status: string) =>
      arr
        .filter((p) => p.ymd.startsWith(monthPrefix))
        .map((p) => ({
          id: p.id,
          title: p.title,
          ymd: p.ymd,
          dayOfWeek: dayNameFromYmd(p.ymd),
          status,
        }));
    currentMonthPosts = [
      ...filterByMonth(published, 'published'),
      ...filterByMonth(scheduled, 'scheduled'),
    ].sort((a, b) => a.ymd.localeCompare(b.ymd));
  }

  const ytdTotal = months.reduce(
    (acc, m) => ({
      published: acc.published + m.published,
      scheduled: acc.scheduled + m.scheduled,
      total: acc.total + m.total,
    }),
    { published: 0, scheduled: 0, total: 0 },
  );

  return { view: 'monthly', year, months, ytdTotal, currentMonthPosts };
}

async function buildSummaryView(year: number) {
  const startYmd = `${year}-01-01`;
  const endYmd = `${year}-12-31`;

  const [published, scheduled, drafts] = await Promise.all([
    getPostsByStatus({ status: 'publish', afterYmd: startYmd, beforeYmd: endYmd }),
    getPostsByStatus({ status: 'future', afterYmd: startYmd, beforeYmd: endYmd }),
    // Drafts are bucketed by last-modified month, so fetch by modified date.
    getPostsByStatus({ status: 'draft', afterYmd: startYmd, orderBy: 'modified', order: 'desc' }),
  ]);

  const now = new Date();
  const currentMonth0 = now.getUTCFullYear() === year ? now.getUTCMonth() : 11;

  // Only show months through current (or all 12 if year is in the past)
  const months = Array.from({ length: currentMonth0 + 1 }, (_, i) => ({
    month: MONTH_LABELS[i],
    published: 0,
    draft: 0,
    scheduled: 0,
    total: 0,
  }));

  for (const p of published) {
    if (yearFromYmd(p.ymd) === year) {
      const m0 = monthNumberFromYmd(p.ymd) - 1;
      if (m0 <= currentMonth0) months[m0].published++;
    }
  }
  for (const p of scheduled) {
    if (yearFromYmd(p.ymd) === year) {
      const m0 = monthNumberFromYmd(p.ymd) - 1;
      if (m0 <= currentMonth0) months[m0].scheduled++;
    }
  }
  // Drafts: bucket by last-modified month (matches blog-wordpress-scheduler summary)
  for (const p of drafts) {
    const my = p.modifiedYmd || p.ymd;
    if (yearFromYmd(my) === year) {
      const m0 = monthNumberFromYmd(my) - 1;
      if (m0 <= currentMonth0) months[m0].draft++;
    }
  }
  for (const m of months) m.total = m.published + m.draft + m.scheduled;

  const ytdTotal = months.reduce(
    (acc, m) => ({
      published: acc.published + m.published,
      draft: acc.draft + m.draft,
      scheduled: acc.scheduled + m.scheduled,
      total: acc.total + m.total,
    }),
    { published: 0, draft: 0, scheduled: 0, total: 0 },
  );

  return { view: 'summary', year, months, ytdTotal };
}
