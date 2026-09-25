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
