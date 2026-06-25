import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  findOpenSlots,
  validateSlot,
  ymdToPublishIsoUtc,
} from '../lib/scheduling.js';
import { getScheduledPosts, schedulePost } from '../lib/wordpress.js';

export const rescheduleWpPostTool = createTool({
  id: 'reschedule_wp_post',
  description:
    'Schedule (or reschedule) a WordPress post to a specific publish date at 8am PST. Pass either a YYYY-MM-DD target date, or the literal string "next" to auto-pick the next available slot per the editorial rules (Tue/Thu first, no Fri/Sat/Sun, no holidays, no same-day conflicts). Validates the target date and rejects with reasons + 3 suggested alternatives if it violates a rule. On success, flips the post from draft → future.',
  inputSchema: z.object({
    postId: z
      .number()
      .int()
      .positive()
      .describe('WordPress post ID to schedule (from stage_to_wordpress).'),
    target: z
      .string()
      .describe('Either a YYYY-MM-DD date or the literal string "next" to auto-pick.'),
    embargo: z
      .string()
      .optional()
      .describe(
        'Optional YYYY-MM-DD embargo — no slot before this date will be accepted (only applies to "next" mode and validation).',
      ),
  }),
  execute: async ({ postId, target, embargo }) => {
    const t0 = Date.now();
    console.log(`[reschedule_wp_post] start: postId=${postId} target=${target} embargo=${embargo ?? '-'}`);
    try {
      const scheduled = await getScheduledPosts();
      const scheduledDates = new Set(scheduled.map((p) => p.ymd));
      const scheduledByDate = new Map(scheduled.map((p) => [p.ymd, p.id]));

      let chosenYmd: string;
      let auto = false;

      if (target === 'next') {
        const slots = findOpenSlots({
          count: 1,
          embargo,
          scheduledDates,
          excludePostId: postId,
          scheduledByDate,
        });
        if (slots.length === 0) {
          return {
            error:
              'No open slot found within the next 60 days under the editorial rules. Provide an explicit YYYY-MM-DD instead.',
          };
        }
        chosenYmd = slots[0];
        auto = true;
      } else {
        // Validate the user's date
        if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) {
          return { error: `Target must be YYYY-MM-DD or "next" — got "${target}".` };
        }
        const rejection = validateSlot(target, {
          scheduledDates,
          embargo,
          excludePostId: postId,
          scheduledByDate,
        });
        if (rejection !== null) {
          const alternatives = findOpenSlots({
            count: 3,
            afterYmd: target,
            embargo,
            scheduledDates,
            excludePostId: postId,
            scheduledByDate,
          });
          return {
            error: `${target} is not a valid slot (${rejection}).`,
            rejection,
            suggestions: alternatives,
          };
        }
        chosenYmd = target;
      }

      const isoLocal = ymdToPublishIsoUtc(chosenYmd);
      const updated = await schedulePost(postId, isoLocal);

      console.log(`[reschedule_wp_post] done in ${Date.now() - t0}ms (scheduled for ${chosenYmd}${auto ? ', auto-picked' : ''})`);
      return {
        success: true,
        postId: updated.id,
        title: updated.title,
        scheduledFor: chosenYmd,
        publishTimePst: '8:00 AM PST',
        previewUrl: updated.link,
        editUrl: updated.editLink,
        autoPicked: auto,
      };
    } catch (e) {
      console.log(`[reschedule_wp_post] error in ${Date.now() - t0}ms: ${e instanceof Error ? e.message : String(e)}`);
      return {
        error: `reschedule_wp_post failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
});
