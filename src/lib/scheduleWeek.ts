import { startOfWeek, differenceInCalendarWeeks } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { formatLocalDateInTz } from '@/lib/shiftInterval';

/**
 * Turn a `YYYY-MM-DD` string into a floating local date at midnight.
 *
 * `startOfWeek` reads `getDay()`, which is host-local. A floating date keeps
 * the day of the week that the string names, whatever the host timezone is.
 */
function civilDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The Monday of the week that today falls in, in the restaurant timezone.
 *
 * Warning: never call `startOfWeek(new Date(), ...)` for this. A host-timezone
 * week start caused a $2,246 wage error. See `memory/lessons.md:272`.
 */
export function getRestaurantWeekStart(now: Date, tz: string): Date {
  return startOfWeek(civilDate(formatLocalDateInTz(now, tz)), {
    weekStartsOn: WEEK_STARTS_ON,
  });
}

/** State the viewed week as a position, not as a date range. */
export function getRelativeWeekLabel(viewedWeekStart: Date, now: Date, tz: string): string {
  const currentWeekStart = getRestaurantWeekStart(now, tz);
  const offset = differenceInCalendarWeeks(viewedWeekStart, currentWeekStart, {
    weekStartsOn: WEEK_STARTS_ON,
  });

  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  if (offset > 1) return `In ${offset} weeks`;
  return `${Math.abs(offset)} weeks ago`;
}
