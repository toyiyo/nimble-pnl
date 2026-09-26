import { addDays, differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';

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
