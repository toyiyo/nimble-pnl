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
