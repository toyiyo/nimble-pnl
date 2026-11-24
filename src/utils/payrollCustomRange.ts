import { addDays, differenceInCalendarDays, endOfDay, endOfWeek, startOfDay, startOfWeek, subWeeks } from 'date-fns';
import { WEEK_STARTS_ON } from '@/lib/dateConfig';
import { parseDateOnly } from '@/lib/dateOnly';

/**
 * Step a Payroll custom range one period back (`-1`) or forward (`1`).
 *
 * The range is local midnight of the first day to the local end of the last
 * day. The step keeps the same number of calendar days. A step by
 * `end - start` milliseconds is 1 ms short of whole days, so each step moved
 * the end into the next day and gave the range one more day.
 */
export function stepCustomRange(
  start: Date,
  end: Date,
  direction: -1 | 1,
): { start: Date; end: Date } {
  const dayCount = differenceInCalendarDays(end, start) + 1;
  // An end before the start is not a range. Do not step it.
  if (dayCount < 1) return { start, end };
  const shift = direction * dayCount;
  return {
    start: startOfDay(addDays(start, shift)),
    end: endOfDay(addDays(end, shift)),
  };
}

/**
 * Put the two days of a Payroll custom range in order.
 *
 * The date inputs do not stop the user from a start after the end. The
 * payroll loader rejects such a range, so swap the two days, as the Labor
 * page does (`resolveRange` in `src/lib/laborPnlAnalytics.ts`).
 */
export function orderCustomRange(start: Date, end: Date): { start: Date; end: Date } {
  if (differenceInCalendarDays(end, start) >= 0) return { start, end };
  return { start: startOfDay(end), end: endOfDay(start) };
}

export type PresetPayrollPeriod = 'current_week' | 'last_week' | 'last_2_weeks';

/**
 * Build a preset Payroll range from the restaurant "today" (`YYYY-MM-DD`).
 *
 * Do not use the browser clock here. The payroll engine maps `deactivated_at`
 * to the restaurant day. When the browser day and the restaurant day are
 * different, a browser week can start after the restaurant week of the
 * deactivation, and the engine then drops the employee from the period.
 */
export function presetPayrollRange(
  period: PresetPayrollPeriod,
  restaurantToday: string,
): { start: Date; end: Date } {
  const today = parseDateOnly(restaurantToday);
  const lastWeek = subWeeks(today, 1);
  const opts = { weekStartsOn: WEEK_STARTS_ON } as const;
  switch (period) {
    case 'current_week':
      return { start: startOfWeek(today, opts), end: endOfWeek(today, opts) };
    case 'last_week':
      return { start: startOfWeek(lastWeek, opts), end: endOfWeek(lastWeek, opts) };
    case 'last_2_weeks':
      return { start: startOfWeek(subWeeks(lastWeek, 1), opts), end: endOfWeek(lastWeek, opts) };
  }
}
