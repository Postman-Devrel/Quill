import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { findOpenSlots } from '../lib/scheduling.js';
import { getScheduledPosts } from '../lib/wordpress.js';

export const findNextWpSlotTool = createTool({
  id: 'find_next_wp_slot',
  description:
    'Find the next available publish slot(s) for blog.postman.com per the editorial rules: 8am PST, Tue/Thu first within 2 weeks, then Wed/Mon, never Fri/Sat/Sun, no US holidays, no same-day conflicts with existing scheduled posts. Returns up to N open slots in YYYY-MM-DD form. Use this before reschedule_wp_post when the user asks "when can this go live?" or wants options.',
  inputSchema: z.object({
    count: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .describe('How many open slots to return. Defaults to 3.'),
    afterDate: z
      .string()
      .optional()
      .describe('YYYY-MM-DD. Only consider dates on or after this. Defaults to tomorrow.'),
    embargo: z
      .string()
      .optional()
      .describe(
        'YYYY-MM-DD. If provided, no slot before this date is returned (e.g. announcement embargo).',
      ),
  }),
  execute: async ({ count, afterDate, embargo }) => {
    const t0 = Date.now();
    console.log(`[find_next_wp_slot] start: count=${count ?? 3} afterDate=${afterDate ?? '-'} embargo=${embargo ?? '-'}`);
    try {
      const scheduled = await getScheduledPosts();
      const scheduledDates = new Set(scheduled.map((p) => p.ymd));
      const slots = findOpenSlots({
        count: count ?? 3,
        afterYmd: afterDate,
        embargo,
        scheduledDates,
      });
      console.log(`[find_next_wp_slot] done in ${Date.now() - t0}ms (${slots.length} slots, ${scheduled.length} already scheduled)`);
      return {
        success: true,
        slots,
        alreadyScheduled: scheduled.map((p) => ({
          id: p.id,
          title: p.title,
          ymd: p.ymd,
        })),
      };
    } catch (e) {
      console.log(`[find_next_wp_slot] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `find_next_wp_slot failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
