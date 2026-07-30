import { format } from 'date-fns';
import { TimePunch } from '@/types/timeTracking';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';
import { toBusinessDayFor, type BusinessDayConfig } from '@/lib/businessDay';

export interface DayHours {
  totalHours: number;
  breakHours: number;
  netHours: number;
}

/**
 * Pair `punches` into work sessions and bucket each COMPLETE session's hours
 * into its clock-in BUSINESS day. Only days present in `days` are kept.
 * Pass BUFFERED punches (±18h) so overnight shifts pair whole; attribution by
 * clock-in day keeps each shift on a single row.
 *
 * `days` are local-midnight calendar-day tokens (from eachDayOfInterval), so
 * they seed the map via plain `format()`. Only the SESSION side is reframed --
 * the row labels are already day tokens and have no instant to convert.
 */
export function hoursByClockInDay(
  punches: TimePunch[],
  days: Date[],
  businessDay: BusinessDayConfig
): Map<string, DayHours> {
  const result = new Map<string, DayHours>();
  for (const day of days) {
    result.set(format(day, 'yyyy-MM-dd'), { totalHours: 0, breakHours: 0, netHours: 0 });
  }

  const { sessions } = processPunchesForPeriod(punches);
  for (const session of sessions) {
    if (!session.is_complete) continue; // open shift contributes no hours yet
    const key = toBusinessDayFor(session.clock_in, businessDay);
    const bucket = result.get(key);
    if (!bucket) continue; // clock-in day outside the displayed range
    bucket.totalHours += session.total_minutes / 60;
    bucket.breakHours += session.break_minutes / 60;
    bucket.netHours += session.worked_minutes / 60;
  }
  return result;
}

/**
 * Group raw punches by the BUSINESS day of the shift each one belongs to.
 *
 * Not by each punch's own business day: a 6 PM -> 3 AM shift's clock-out is a
 * 3 AM instant, which at cutoff 2 is its own next business day. Keying punches
 * individually would print the clock-out on tomorrow's row while
 * hoursByClockInDay put the shift's hours on today's -- a timecard that
 * contradicts its own total. The clock-in-anchored state machine below keeps
 * every punch of a shift together, mirroring the punchesByWeek grouping in
 * calculateActualLaborCostForMonth.
 *
 * Sorted defensively: the state machine needs chronological order and must not
 * depend on the caller's query ordering.
 */
export function punchesByBusinessDay(
  punches: TimePunch[],
  days: Date[],
  businessDay: BusinessDayConfig
): Map<string, TimePunch[]> {
  const result = new Map<string, TimePunch[]>();
  for (const day of days) {
    result.set(format(day, 'yyyy-MM-dd'), []);
  }

  const sorted = [...punches].sort(
    (a, b) => new Date(a.punch_time).getTime() - new Date(b.punch_time).getTime()
  );

  let openShiftKey: string | null = null;
  for (const punch of sorted) {
    if (punch.punch_type === 'clock_in') {
      openShiftKey = toBusinessDayFor(punch.punch_time, businessDay);
    }
    // An orphaned punch (no open shift) falls back to its own business day --
    // it is the only anchor available, and hiding it would hide a data problem
    // the employee needs to see.
    const key = openShiftKey ?? toBusinessDayFor(punch.punch_time, businessDay);
    result.get(key)?.push(punch);
    if (punch.punch_type === 'clock_out') openShiftKey = null;
  }

  return result;
}
