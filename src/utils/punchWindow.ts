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
import { formatLocalDate } from '@/lib/shiftInterval';
import {
  addDaysToDayToken,
  businessDayStartInstant,
  toBusinessDayFor,
  type BusinessDayConfig,
} from '@/lib/businessDay';

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
 * The fetch range for a caller that then filters by BUSINESS day
 * (`periodsInBusinessDayWindow`): every instant that filter can keep, plus an
 * overnight buffer on each side so boundary-crossing shifts pair whole.
 *
 * `start` and `end` are read as calendar-day TOKENS via their local fields —
 * the same reading `isWithinBusinessDayWindow` gives them, which is the whole
 * point. A fixed-hour buffer around the bounds as INSTANTS cannot do this job:
 * the bounds are built in the BROWSER's zone (startOfWeek/endOfWeek in
 * Payroll.tsx) while the business day is resolved in the RESTAURANT's, and the
 * two zones can be up to 26 hours apart. At an 18h buffer a viewer in
 * Pacific/Auckland (UTC+13) loading a US-Pacific (UTC-8) restaurant's payroll
 * would stop fetching an hour inside the period's last business day, and the
 * shifts past that point would be dropped by the filter here AND by the next
 * period's filter (whose day tokens start later still) — silently unpaid on
 * both checks. Anchoring on the business-day boundary instants removes the
 * zone spread from the arithmetic entirely.
 *
 * The buffer that remains is only about PAIRING: a clock-in at the very end of
 * the last business day can clock out up to MAX_SHIFT_GAP_HOURS later, and a
 * shift running into the first business day can have clocked in that long
 * before it. Since OVERNIGHT_BUFFER_HOURS equals that cap exactly, the extra
 * DST_SLACK_HOURS is not decoration — a DST transition moves the day boundary
 * businessDayStartInstant reports by up to an hour, in either direction (see
 * its docs), and without the slack that hour comes straight out of the pairing
 * budget: a maximal shift at the edge would pair as incomplete and its hours
 * would go unpaid.
 */
export const DST_SLACK_HOURS = 1;

export function businessDayPunchFetchRange(
  start: Date,
  end: Date,
  businessDay: BusinessDayConfig,
  hours: number = OVERNIGHT_BUFFER_HOURS,
): { fetchStart: Date; fetchEnd: Date } {
  const ms = (hours + DST_SLACK_HOURS) * 60 * 60 * 1000;
  const firstDayStart = businessDayStartInstant(formatLocalDate(start), businessDay);
  // The end bound is INCLUSIVE of `end`'s business day, which runs until the
  // NEXT day's cutoff.
  const lastDayEnd = businessDayStartInstant(
    addDaysToDayToken(formatLocalDate(end), 1),
    businessDay,
  );
  return {
    fetchStart: new Date(firstDayStart.getTime() - ms),
    fetchEnd: new Date(lastDayEnd.getTime() + ms),
  };
}

/** Inclusive on both boundaries, matching Supabase .gte/.lte semantics. */
export function isWithinWindow(time: Date | string, start: Date, end: Date): boolean {
  const t = time instanceof Date ? time.getTime() : new Date(time).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * Inclusive day-token window: is `time`'s BUSINESS day inside the calendar days
 * the [start, end] bounds name?
 *
 * The bounds are read as calendar-day TOKENS via their local fields, not as
 * instants — every caller builds them with `startOfWeek`/`endOfWeek`/
 * `new Date(y, m, d)`, whose local fields read back unchanged in any zone. The
 * comparison is lexicographic on `YYYY-MM-DD`, which is ordered the same as the
 * dates it encodes.
 *
 * At `cutoffHour = 0` in the host zone this agrees with `isWithinWindow` for
 * every instant except those in the last millisecond gap of an end-of-day
 * bound, which no punch occupies in practice.
 */
export function isWithinBusinessDayWindow(
  time: Date | string,
  start: Date,
  end: Date,
  businessDay: BusinessDayConfig,
): boolean {
  const day = toBusinessDayFor(time, businessDay);
  return day >= formatLocalDate(start) && day <= formatLocalDate(end);
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

/**
 * The business-day form of `periodsInWindow`, for callers that then band or
 * bucket by business day.
 *
 * Use this, not `periodsInWindow`, wherever the selected periods feed a
 * business-day calculation. Selecting on the raw instant and banding on the
 * business day mixes two frames: at cutoff 2, a 01:00 Monday shift belongs to
 * Sunday's business day but sits in Monday's instant window, so the period that
 * bands its business week never sees it and the period that does see it bands
 * it, alone, against a week whose other hours were paid on the previous check.
 * Hours still conserve; the OVERTIME PREMIUM on them does not. Pinned by
 * tests/unit/payroll-business-day-conservation.test.ts.
 *
 * Attribution stays exactly-once because the business day is a total, monotone
 * function of the instant: adjacent day-token windows tile the timeline with no
 * gap and no overlap, exactly as the instant windows they replace did.
 */
export function periodsInBusinessDayWindow<T extends { startTime: Date; clockIn?: Date }>(
  periods: T[],
  start: Date,
  end: Date,
  businessDay: BusinessDayConfig,
): T[] {
  return periods.filter((p) =>
    isWithinBusinessDayWindow(p.clockIn ?? p.startTime, start, end, businessDay),
  );
}

/** Keep incomplete shifts whose anchor punch (punchTime) is in [start, end]. */
export function incompleteShiftsInWindow<T extends { punchTime: Date }>(shifts: T[], start: Date, end: Date): T[] {
  return shifts.filter((s) => isWithinWindow(s.punchTime, start, end));
}

/** The business-day form of `incompleteShiftsInWindow`. See above for why. */
export function incompleteShiftsInBusinessDayWindow<T extends { punchTime: Date }>(
  shifts: T[],
  start: Date,
  end: Date,
  businessDay: BusinessDayConfig,
): T[] {
  return shifts.filter((s) => isWithinBusinessDayWindow(s.punchTime, start, end, businessDay));
}

/** Keep work sessions whose clock_in is in [start, end]. */
export function sessionsWithClockInInWindow<T extends { clock_in: Date }>(sessions: T[], start: Date, end: Date): T[] {
  return sessions.filter((s) => isWithinWindow(s.clock_in, start, end));
}
