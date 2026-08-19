import { subDays } from 'date-fns';
import { formatLocalDate } from '@/lib/shiftInterval';
import { getRestaurantWeekStart } from '@/lib/scheduleWeek';

export interface PublicationWeek {
  week_start_date: string;
}

/**
 * The oldest `week_start_date` that still counts as a recent publication.
 *
 * 8 days, not 7. `week_start_date` records the manager device day, not the
 * restaurant day, so a manager in another timezone can write a Monday one day
 * away from the restaurant Monday. The extra day absorbs that skew.
 */
export function publishWindowStart(now: Date, tz: string): string {
  return formatLocalDate(subDays(getRestaurantWeekStart(now, tz), 8));
}

/**
 * Does this restaurant publish its schedule?
 *
 * A restaurant that never publishes has `is_published = false` on every shift.
 * Its employees would see every row dashed and muted, and a signal that never
 * varies is not a signal. Anchor the window to today, never to the viewed week.
 *
 * A `YYYY-MM-DD` string sorts the same way as the date it names, so a string
 * compare is correct here.
 */
export function isPublishingRestaurant(
  publications: PublicationWeek[],
  now: Date,
  tz: string
): boolean {
  const windowStart = publishWindowStart(now, tz);
  return publications.some((p) => p.week_start_date >= windowStart);
}
