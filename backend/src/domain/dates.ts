/**
 * Date helpers for WB Shturval.
 *
 * All "days" in product logic are computed in Moscow time (MSK, UTC+3, no DST),
 * because that is the timezone Wildberries data and the seller live in. Using a
 * fixed +3 offset is correct for MSK (Russia abolished DST in 2014).
 *
 * A "day" is represented as a calendar string "YYYY-MM-DD" so comparisons and
 * grouping are unambiguous and timezone-stable.
 */

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Calendar date string "YYYY-MM-DD" for a given instant, in MSK. */
export function mskDateString(date: Date): string {
  const shifted = new Date(date.getTime() + MSK_OFFSET_MS);
  // Use UTC getters on the shifted instant to read MSK wall-clock date.
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Today's calendar date in MSK. `now` is injectable for tests. */
export function todayMsk(now: Date = new Date()): string {
  return mskDateString(now);
}

/** Parse "YYYY-MM-DD" into a UTC Date at midnight (date-only arithmetic). */
export function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Add `n` days to a date string, returning a new "YYYY-MM-DD". */
export function addDaysStr(dateStr: string, n: number): string {
  const base = parseDateStr(dateStr);
  base.setUTCDate(base.getUTCDate() + n);
  return mskDateString(new Date(base.getTime() - MSK_OFFSET_MS));
}

/** Whole-day difference a - b (in days). Positive if a is later than b. */
export function diffDaysStr(a: string, b: string): number {
  const ms = parseDateStr(a).getTime() - parseDateStr(b).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Monday (ISO week start) of the week containing `dateStr`, in MSK calendar. */
export function weekStartStr(dateStr: string): string {
  const d = parseDateStr(dateStr);
  // getUTCDay: 0=Sun..6=Sat. ISO week starts Monday.
  const dow = d.getUTCDay();
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  return addDaysStr(dateStr, deltaToMonday);
}

/** Number of elapsed days of the current week including `dateStr` (1..7). */
export function elapsedWeekDays(dateStr: string): number {
  return diffDaysStr(dateStr, weekStartStr(dateStr)) + 1;
}
