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

interface CandidatePhase {
  weekdays: number[]; // which weekday integers to try (Sun=0, Mon=1, ...)
  windowDays: number;
}

/**
 * Find the next N available slots per the Tue/Thu-first priority rules.
 *
 * Phase 1: Tue, Thu within 14 days.
 * Phase 2: Wed, Mon within 14 days.
 * Phase 3: any Mon–Thu beyond 14 days, up to maxLookaheadDays.
 */
export function findOpenSlots(opts: FindNextSlotOptions): string[] {
  const startYmd = opts.afterYmd ?? toYMD(addDays(new Date(), 1));
  const startDate = ymdToDate(startYmd);
  const count = opts.count ?? 1;
  const maxDays = opts.maxLookaheadDays ?? 60;

  const phases: CandidatePhase[] = [
    { weekdays: [2, 4], windowDays: 14 }, // Tue + Thu
    { weekdays: [3, 1], windowDays: 14 }, // Wed + Mon
    { weekdays: [1, 2, 3, 4], windowDays: maxDays }, // fallback: any Mon–Thu
  ];

  const found: string[] = [];
  const seen = new Set<string>();

  for (const phase of phases) {
    for (let offset = 0; offset <= phase.windowDays && found.length < count; offset++) {
      const day = addDays(startDate, offset);
      const weekday = day.getUTCDay();
      if (!phase.weekdays.includes(weekday)) continue;
      const ymd = toYMD(day);
      if (seen.has(ymd)) continue;
      if (validateSlot(ymd, opts) !== null) continue;
      found.push(ymd);
      seen.add(ymd);
    }
    if (found.length >= count) break;
  }
  return found;
}
