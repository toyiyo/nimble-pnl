import { format } from 'date-fns';
import { TimePunch } from '@/types/timeTracking';
import { toBusinessDay } from '@/lib/restaurantClock';
import { processPunchesForPeriod } from '@/utils/timePunchProcessing';

export interface DayHours {
  totalHours: number;
  breakHours: number;
  netHours: number;
}

/**
 * Pair `punches` into work sessions and bucket each COMPLETE session's hours
 * into its clock-in day IN THE RESTAURANT'S TIMEZONE. Only days present in
 * `days` are kept. Pass BUFFERED punches (±18h) so overnight shifts pair
 * whole; attribution by clock-in day keeps each shift on a single day.
 *
 * `timezone` is required, not defaulted: this must agree with how the caller
 * buckets the punches themselves, or one day's card shows a punch whose hours
 * were counted against a different day.
 */
export function hoursByClockInDay(
  punches: TimePunch[],
  days: Date[],
  timezone: string
): Map<string, DayHours> {
  const result = new Map<string, DayHours>();
  for (const day of days) {
    // `days` are calendar-day tokens, so local fields are correct here.
    result.set(format(day, 'yyyy-MM-dd'), { totalHours: 0, breakHours: 0, netHours: 0 });
  }

  const { sessions } = processPunchesForPeriod(punches);
  for (const session of sessions) {
    if (!session.is_complete) continue; // open shift contributes no hours yet
    // clock_in is an instant; attribute it to the restaurant's day.
    const key = toBusinessDay(session.clock_in, timezone);
    const bucket = result.get(key);
    if (!bucket) continue; // clock-in day outside the displayed range
    bucket.totalHours += session.total_minutes / 60;
    bucket.breakHours += session.break_minutes / 60;
    bucket.netHours += session.worked_minutes / 60;
  }
  return result;
}
