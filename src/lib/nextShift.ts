import { addDays } from 'date-fns';
import { formatLocalDate, formatLocalDateInTz } from '@/lib/shiftInterval';
import type { Shift } from '@/types/scheduling';

/**
 * The shifts the employee still has to work, soonest first.
 *
 * A shift that has started but not ended stays in the list. The employee is
 * at work, and the anchor must agree with that.
 *
 * The publish state is not a filter. A draft shift is a shift.
 */
export function selectUpcomingShifts(shifts: Shift[], now: Date, limit = 5): Shift[] {
  return shifts
    .filter((s) => s.status !== 'cancelled' && new Date(s.end_time) > now)
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    .slice(0, limit);
}

/**
 * How many shifts fall in one week, on the restaurant calendar.
 *
 * The bucket comes from `start_time` in the restaurant timezone. A shift that
 * starts at 21:00 on a Sunday belongs to the week that ends, even when the
 * viewer sits in a timezone where the clock already reads Monday.
 */
export function countShiftsInWeek(shifts: Shift[], weekStart: Date, tz: string): number {
  const firstDay = formatLocalDate(weekStart);
  const lastDay = formatLocalDate(addDays(weekStart, 6));

  return shifts.filter((s) => {
    if (s.status === 'cancelled') return false;
    const day = formatLocalDateInTz(new Date(s.start_time), tz);
    return day >= firstDay && day <= lastDay;
  }).length;
}
