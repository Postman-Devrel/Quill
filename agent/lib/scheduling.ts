/**
 * Blog scheduling rules for blog.postman.com:
 * - 8:00 AM PST (16:00 UTC) for every post
 * - Tue/Thu first (within a 2-week window starting tomorrow)
 * - Mon/Wed only if all Tue/Thu in the next 2 weeks are taken
 * - Never Fri/Sat/Sun
 * - Skip US public holidays
 * - One post per day (no same-day conflicts)
 * - Optional embargo date — never before it
 *
 * We treat PST as a fixed UTC-8 offset year-round (no DST handling).
 */

const PUBLISH_HOUR_UTC = 16; // 8am PST = 16:00 UTC

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers (UTC-based; we never touch local-time methods)
// ─────────────────────────────────────────────────────────────────────────────

export function toYMD(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ymdToDate(ymd: string): Date {
  // Construct as 16:00 UTC so getUTCDay() returns the weekday for 8am PST same day
  return new Date(`${ymd}T${String(PUBLISH_HOUR_UTC).padStart(2, '0')}:00:00.000Z`);
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** ISO 8601 string at 8am PST (16:00 UTC) for the given YYYY-MM-DD. */
export function ymdToPublishIsoUtc(ymd: string): string {
  return `${ymd}T${String(PUBLISH_HOUR_UTC).padStart(2, '0')}:00:00`;
}

// ─────────────────────────────────────────────────────────────────────────────
// US holiday computation (fixed + floating)
// ─────────────────────────────────────────────────────────────────────────────

function nthWeekdayOfMonth(year: number, month0: number, weekday: number, n: number): string {
  const firstOfMonth = new Date(Date.UTC(year, month0, 1, PUBLISH_HOUR_UTC));
  const firstWeekday = firstOfMonth.getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return toYMD(new Date(Date.UTC(year, month0, day)));
}

function lastWeekdayOfMonth(year: number, month0: number, weekday: number): string {
  const lastOfMonth = new Date(Date.UTC(year, month0 + 1, 0, PUBLISH_HOUR_UTC));
  const lastWeekday = lastOfMonth.getUTCDay();
  const offset = (lastWeekday - weekday + 7) % 7;
  const day = lastOfMonth.getUTCDate() - offset;
  return toYMD(new Date(Date.UTC(year, month0, day)));
}

/** Returns a Set of YYYY-MM-DD strings for US public holidays in the given year. */
export function usHolidaysForYear(year: number): Set<string> {
  const set = new Set<string>();
  // Fixed-date holidays
  set.add(`${year}-01-01`); // New Year's Day
  set.add(`${year}-06-19`); // Juneteenth
  set.add(`${year}-07-04`); // Independence Day
  set.add(`${year}-11-11`); // Veterans Day
  set.add(`${year}-12-25`); // Christmas

  // Floating holidays (Sun=0, Mon=1, ..., Sat=6)
  set.add(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK Day — 3rd Mon of Jan
  set.add(nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents' Day — 3rd Mon of Feb
  set.add(lastWeekdayOfMonth(year, 4, 1)); // Memorial Day — last Mon of May
  set.add(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor Day — 1st Mon of Sep
  set.add(nthWeekdayOfMonth(year, 9, 1, 2)); // Columbus Day — 2nd Mon of Oct
  set.add(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving — 4th Thu of Nov
  return set;
}

/** Is the given YYYY-MM-DD a US public holiday? */
export function isHoliday(ymd: string): boolean {
  const year = Number(ymd.slice(0, 4));
  return usHolidaysForYear(year).has(ymd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot validation + finding
// ─────────────────────────────────────────────────────────────────────────────

export type SlotRejection =
  | 'past'
  | 'weekend'
  | 'friday'
  | 'holiday'
  | 'conflict'
  | 'before-embargo';

export interface ValidateSlotOptions {
  /** YYYY-MM-DD strings of days that already have a scheduled post. */
  scheduledDates: Set<string>;
  /** Optional YYYY-MM-DD; reject any candidate strictly before this. */
  embargo?: string;
  /** PostId we're rescheduling, if any — its current slot doesn't count as a conflict. */
  excludePostId?: number;
  /** Map of scheduled-date YYYY-MM-DD → postId, for excludePostId logic. */
  scheduledByDate?: Map<string, number>;
}

/** Returns null if the slot is valid, otherwise the reason it was rejected. */
export function validateSlot(
  ymd: string,
  opts: ValidateSlotOptions,
): SlotRejection | null {
  const candidate = ymdToDate(ymd);
  const now = new Date();
  if (candidate.getTime() <= now.getTime()) return 'past';

  const weekday = candidate.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (weekday === 0 || weekday === 6) return 'weekend';
  if (weekday === 5) return 'friday';

  if (isHoliday(ymd)) return 'holiday';

  if (opts.embargo && ymd < opts.embargo) return 'before-embargo';

  if (opts.scheduledDates.has(ymd)) {
    // Allow the same post to keep its own date when rescheduling
    if (opts.excludePostId !== undefined && opts.scheduledByDate) {
      const existing = opts.scheduledByDate.get(ymd);
      if (existing === opts.excludePostId) return null;
    }
    return 'conflict';
  }
  return null;
}

export interface FindNextSlotOptions extends ValidateSlotOptions {
  /** Inclusive lower bound — defaults to tomorrow. */
  afterYmd?: string;
  /** Number of slots to return (e.g. 3 for "next 3 open slots"). */
  count?: number;
  /** Hard upper bound on lookahead (days from afterYmd). Default 60. */
  maxLookaheadDays?: number;
}

/**
 * Find the next N available slots, mirroring the blog-wordpress-scheduler skill
 * (references/wp-find-slot.py) priority rules exactly:
 *
 *   Phase 1: Tue/Thu within the next 2 weeks (chronological).
 *   Phase 2: Mon/Wed within the next 2 weeks — ONLY when no Tue/Thu slot is
 *            open anywhere in that window (i.e. every Tue/Thu is booked/holiday).
 *   Phase 3: beyond 2 weeks — scanned week by week, trying weekdays in priority
 *            order [Tue, Thu, Wed, Mon] within each week.
 *
 * Tue/Thu are always preferred. When Phase 1 finds some (but fewer than
 * `count`) slots, we top up from Phase 3 — which is itself Tue/Thu-first —
 * rather than padding with nearby Mon/Wed. Mon/Wed inside the 2-week window are
 * only ever offered when that window has no open Tue/Thu at all.
 */
const WINDOW_DAYS = 14;

export function findOpenSlots(opts: FindNextSlotOptions): string[] {
  const startYmd = opts.afterYmd ?? toYMD(addDays(new Date(), 1));
  const startDate = ymdToDate(startYmd);
  const count = opts.count ?? 1;
  const maxDays = opts.maxLookaheadDays ?? 60;

  const found: string[] = [];
  const seen = new Set<string>();

  const tryPush = (ymd: string): void => {
    if (found.length >= count) return;
    if (seen.has(ymd)) return;
    if (validateSlot(ymd, opts) !== null) return;
    found.push(ymd);
    seen.add(ymd);
  };

  // Phase 1 — Tue/Thu within the 2-week window (chronological).
  for (let offset = 0; offset < WINDOW_DAYS && found.length < count; offset++) {
    const day = addDays(startDate, offset);
    if (day.getUTCDay() === 2 || day.getUTCDay() === 4) tryPush(toYMD(day));
  }

  // Phase 2 — Mon/Wed within the 2-week window, only if NO Tue/Thu was open.
  if (found.length === 0) {
    for (let offset = 0; offset < WINDOW_DAYS && found.length < count; offset++) {
      const day = addDays(startDate, offset);
      if (day.getUTCDay() === 1 || day.getUTCDay() === 3) tryPush(toYMD(day));
    }
  }

  // Phase 3 — beyond 2 weeks: week by week, priority order [Tue, Thu, Wed, Mon].
  if (found.length < count) {
    const PRIORITY = [2, 4, 3, 1]; // Tue, Thu, Wed, Mon (JS weekday indices)
    const beyondStart = addDays(startDate, WINDOW_DAYS);
    // Snap back to the Monday of that week so we scan whole weeks in priority order.
    const weekStart = addDays(beyondStart, -((beyondStart.getUTCDay() + 6) % 7));
    for (let dayOffset = 0; dayOffset <= maxDays && found.length < count; dayOffset += 7) {
      const monday = addDays(weekStart, dayOffset);
      for (const weekday of PRIORITY) {
        const day = addDays(monday, weekday - 1); // Mon=1 → +0, Thu=4 → +3
        if (day.getTime() < beyondStart.getTime()) continue; // stay outside the 2-week window
        tryPush(toYMD(day));
      }
    }
  }

  return found;
}
