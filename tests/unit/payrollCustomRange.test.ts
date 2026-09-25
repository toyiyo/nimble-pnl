import { describe, it, expect } from 'vitest';
import { endOfDay } from 'date-fns';
import { stepCustomRange } from '@/utils/payrollCustomRange';
import { toDateOnlyString } from '@/lib/dateOnly';

// The Payroll page steps a custom range with "previous" / "next". The range
// is local midnight of the first day to the local end of the last day. A step
// by `end - start` milliseconds (7 days minus 1 ms) drifts by 1 ms per step,
// so the second step gave an 8-day range and paid 8 salary days.
const days = (range: { start: Date; end: Date }) => [
  toDateOnlyString(range.start),
  toDateOnlyString(range.end),
];

describe('stepCustomRange', () => {
  const start = new Date(2026, 8, 14); // Mon Sep 14
  const end = endOfDay(new Date(2026, 8, 20)); // Sun Sep 20

  it('keeps 7 whole days after two "previous" steps', () => {
    const once = stepCustomRange(start, end, -1);
    const twice = stepCustomRange(once.start, once.end, -1);
    expect(days(once)).toEqual(['2026-09-07', '2026-09-13']);
    expect(days(twice)).toEqual(['2026-08-31', '2026-09-06']);
    expect(twice.start.getTime()).toBe(new Date(2026, 7, 31).getTime());
    expect(twice.end.getTime()).toBe(endOfDay(new Date(2026, 8, 6)).getTime());
  });

  it('keeps 7 whole days after two "next" steps', () => {
    const once = stepCustomRange(start, end, 1);
    const twice = stepCustomRange(once.start, once.end, 1);
    expect(days(twice)).toEqual(['2026-09-28', '2026-10-04']);
    expect(twice.end.getTime()).toBe(endOfDay(new Date(2026, 9, 4)).getTime());
  });

  it('keeps the day count of a 10-day range across a DST change', () => {
    const tenStart = new Date(2026, 9, 27); // Oct 27
    const tenEnd = endOfDay(new Date(2026, 10, 5)); // Nov 5
    const next = stepCustomRange(tenStart, tenEnd, 1);
    expect(days(next)).toEqual(['2026-11-06', '2026-11-15']);
  });

  it('steps a one-day range by one day', () => {
    const one = stepCustomRange(new Date(2026, 8, 14), endOfDay(new Date(2026, 8, 14)), -1);
    expect(days(one)).toEqual(['2026-09-13', '2026-09-13']);
  });

  it('returns the input unchanged when the end is before the start', () => {
    const badStart = new Date(2026, 8, 20);
    const badEnd = endOfDay(new Date(2026, 8, 14));
    const stepped = stepCustomRange(badStart, badEnd, 1);
    expect(stepped.start).toBe(badStart);
    expect(stepped.end).toBe(badEnd);
  });
});
