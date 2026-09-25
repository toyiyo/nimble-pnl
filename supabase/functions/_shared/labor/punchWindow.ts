import {
  addDaysToDateStr,
  firstInstantOfDay,
  weekEndDateStr,
  weekStartDateStr,
} from './restaurantClock.ts';

/**
 * Overnight-shift fetch windowing helpers.
 *
 * Punch fetches must be widened by this buffer so a shift whose clock_in and
 * clock_out straddle the [start, end] boundary is fetched whole; the pairing
 * engine then pairs it and callers attribute it to its clock-in day, dropping
 * shifts whose clock-in falls outside [start, end].
 *
 * OVERNIGHT_BUFFER_HOURS MUST stay >= MAX_SHIFT_GAP_HOURS (payrollCalculations)
 * — the buffer has to be at least as wide as the largest gap the pairing engine
 * will pair, or a boundary-crossing shift's far punch is never fetched. The
 * drift guard test in punchWindow.test.ts enforces this.
 */
export const OVERNIGHT_BUFFER_HOURS = 18;

/** Expand [start, end] by the overnight buffer on both ends for the DB fetch. */
export function bufferPunchFetchRange(
  start: Date,
  end: Date,
  hours: number = OVERNIGHT_BUFFER_HOURS,
): { fetchStart: Date; fetchEnd: Date } {
  const ms = hours * 60 * 60 * 1000;
  return {
    fetchStart: new Date(start.getTime() - ms),
    fetchEnd: new Date(end.getTime() + ms),
  };
}

/**
 * Look-AHEAD-only variant: widen only the end, keep the start unchanged.
 *
 * For consumers whose downstream calc attributes hours/active-days to EVERY day
 * a shift touches and does NOT drop shifts whose clock-in precedes the window
 * (e.g. the dashboard's `calculateActualLaborCost`). A symmetric look-back there
 * would pull a prior-period Sunday-night shift into the first in-range day and
 * overstate labor (double-counting daily-rate and post-midnight-break hours).
 * Use the symmetric `bufferPunchFetchRange` only where callers apply a clock-in
 * attribution filter (payroll, open-sessions) that drops the look-back shifts.
 */
export function lookaheadPunchFetchRange(
  start: Date,
  end: Date,
  hours: number = OVERNIGHT_BUFFER_HOURS,
): { fetchStart: Date; fetchEnd: Date } {
  return { fetchStart: start, fetchEnd: new Date(end.getTime() + hours * 60 * 60 * 1000) };
}

/**
 * Widen a punch-fetch start backward to the start of the restaurant-local
 * week (WEEK_STARTS_ON) that contains the day `fromDay` (`YYYY-MM-DD`), but
 * only when that week start falls before the already-computed `fetchStart`.
 * The week start is the first instant of its first day in `timezone`, so the
 * result does not depend on the host timezone.
 *
 * The OT-banding formula (`calculateActualLaborCostForRange`) buckets
 * punches by ISO week and bands overtime over the FULL week. When
 * `fromDay` does not fall on a week boundary, the days before `fromDay`
 * in that same week must still be fetched, or the week's hour total comes
 * out too low and hours that should band as overtime cost as straight time
 * instead. A caller whose downstream calc attributes hours to every day a
 * shift touches (e.g. `calculateActualLaborCost`, the straight-time daily
 * series) must filter these look-back days back out before using them —
 * this helper only widens the DB fetch.
 */
export function weekAlignedFetchStart(fromDay: string, fetchStart: Date, timezone: string): Date {
  const weekAlignedStart = firstInstantOfDay(weekStartDateStr(fromDay), timezone);
  return weekAlignedStart < fetchStart ? weekAlignedStart : fetchStart;
}

/**
 * Widen a punch-fetch end forward to the end of the restaurant-local week
 * (WEEK_STARTS_ON) that contains the day `toDay` (`YYYY-MM-DD`), but only
 * when that week end falls after the already-computed `fetchEnd`. The week
 * end is 1 ms before the first instant of the next week in `timezone`.
 *
 * Same OT-banding rule as `weekAlignedFetchStart`, applied to the end of
 * the range: when `toDay` does not fall on a week boundary, the days
 * after `toDay` in that same week must still be fetched, or the week's
 * hour total comes out too low and hours that should band as overtime
 * cost as straight time instead. A caller with a separate straight-time
 * daily series must filter these look-ahead days back out before using
 * them — this helper only widens the DB fetch.
 */
export function weekAlignedFetchEnd(toDay: string, fetchEnd: Date, timezone: string): Date {
  const nextWeekStart = firstInstantOfDay(addDaysToDateStr(weekEndDateStr(toDay), 1), timezone);
  const weekAlignedEnd = new Date(nextWeekStart.getTime() - 1);
  return weekAlignedEnd > fetchEnd ? weekAlignedEnd : fetchEnd;
}

/** Inclusive on both boundaries, matching Supabase .gte/.lte semantics. */
export function isWithinWindow(time: Date | string, start: Date, end: Date): boolean {
  const t = time instanceof Date ? time.getTime() : new Date(time).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * Keep work periods whose originating shift clock-in is in [start, end].
 * Filters by `clockIn` when present (the shift's first clock_in, which stays
 * fixed across breaks) and falls back to `startTime` otherwise — so a post-break
 * work segment of an overnight shift is attributed to the shift's clock-in
 * period, not the period its (break-advanced) startTime happens to land in.
 */
export function periodsInWindow<T extends { startTime: Date; clockIn?: Date }>(periods: T[], start: Date, end: Date): T[] {
  return periods.filter((p) => isWithinWindow(p.clockIn ?? p.startTime, start, end));
}

/** Keep incomplete shifts whose anchor punch (punchTime) is in [start, end]. */
export function incompleteShiftsInWindow<T extends { punchTime: Date }>(shifts: T[], start: Date, end: Date): T[] {
  return shifts.filter((s) => isWithinWindow(s.punchTime, start, end));
}

/** Keep work sessions whose clock_in is in [start, end]. */
export function sessionsWithClockInInWindow<T extends { clock_in: Date }>(sessions: T[], start: Date, end: Date): T[] {
  return sessions.filter((s) => isWithinWindow(s.clock_in, start, end));
}
