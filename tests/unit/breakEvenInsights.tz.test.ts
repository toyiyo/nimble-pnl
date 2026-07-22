/**
 * Regression: `deriveWeekdayPattern` must derive each row's weekday via a
 * local-date parser, not native `new Date('2026-06-01')`. The native
 * constructor reads the bare date as UTC midnight; formatted back in a
 * negative-UTC-offset host TZ that lands on 2026-05-31 (Sunday), one weekday
 * earlier than intended (Monday). (date-fns' `parseISO` doesn't have this
 * problem — it already reads date-only strings at local midnight.)
 * Pin TZ=America/Chicago (UTC-5/-6) and assert the weekday grouping is
 * unaffected — matches the convention in tests/unit/cogsCalculations.tz.test.ts.
 */
process.env.TZ = 'America/Chicago';

import { describe, it, expect } from 'vitest';
import { deriveWeekdayPattern, type BreakEvenHistoryEntry } from '@/lib/breakEvenInsights';

function entry(date: string, delta: number): BreakEvenHistoryEntry {
  const breakEven = 1000;
  return {
    date,
    sales: breakEven + delta,
    breakEven,
    delta,
    status: delta > 50 ? 'above' : delta < -50 ? 'below' : 'at',
    isPartial: false,
  };
}

describe('deriveWeekdayPattern — negative UTC offset', () => {
  it('groups by the local calendar weekday, not the UTC-shifted one', () => {
    // Sanity: confirm Chicago really is the host TZ for this test (west of
    // UTC, so `getTimezoneOffset()` is positive).
    expect(new Date().getTimezoneOffset()).toBeGreaterThan(0);

    // Two full weeks starting Monday 2026-06-01. Native `new
    // Date('2026-06-01')` would read this as 2026-06-01T00:00:00Z, which in
    // America/Chicago (UTC-5 in June) formats back to 2026-05-31 19:00 —
    // Sunday, not Monday. A buggy implementation would therefore group this
    // row (and every other row) under the wrong weekday, breaking the
    // clean-split shape below.
    const dates = [
      '2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-06', '2026-06-07',
      '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14',
    ];
    // Mon(1)-Thu(4) below break-even; Fri(5)-Sun(0) above — mirrors the
    // 14-day shape in breakEvenInsights.test.ts.
    const weekdayDeltas: Record<number, number> = {
      1: -900,
      2: -1000,
      3: -1100,
      4: -1200,
      5: 800,
      6: 700,
      0: 600,
    };
    const history = dates.map((date) => {
      const [year, month, day] = date.split('-').map(Number);
      const weekday = new Date(year, month - 1, day).getDay();
      return entry(date, weekdayDeltas[weekday]);
    });

    const result = deriveWeekdayPattern(history);

    expect(result).not.toBeNull();
    expect(result).toContain('Mon–Thu');
    expect(result).toContain('never break even');
    expect(result).toContain('Fri–Sun');
    expect(result).toContain('always do');
  });
});
