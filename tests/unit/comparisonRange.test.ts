import { describe, it, expect } from 'vitest';
import {
  getComparisonRange,
  describeComparison,
  comparisonLabel,
  periodComparison,
  previousPeriodQuery,
} from '@/lib/comparisonRange';

const toDateOnly = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const r = (s: string, e: string, h?: 'week' | 'month' | 'quarter' | 'shift') =>
  getComparisonRange(s, e, h);

describe('getComparisonRange', () => {
  describe('week', () => {
    it('shifts a Monday-start partial week by 7 days', () => {
      expect(r('2026-11-16', '2026-11-21')).toEqual({
        start: '2026-11-09', end: '2026-11-14', kind: 'week', offsetDays: 7,
      });
    });
    it('shifts a full Monday to Sunday week by 7 days', () => {
      expect(r('2026-11-16', '2026-11-22')).toEqual({
        start: '2026-11-09', end: '2026-11-15', kind: 'week', offsetDays: 7,
      });
    });
  });

  describe('month', () => {
    it('clamps Mar 31 to Feb 28', () => {
      expect(r('2026-03-01', '2026-03-31')).toMatchObject({
        start: '2026-02-01', end: '2026-02-28', kind: 'month', offsetDays: 28,
      });
    });
    it('clamps to Feb 29 in a leap year', () => {
      expect(r('2028-03-01', '2028-03-31')).toMatchObject({
        start: '2028-02-01', end: '2028-02-29', kind: 'month',
      });
    });
    it('keeps the same day for a month to date', () => {
      expect(r('2026-11-01', '2026-11-21')).toMatchObject({
        start: '2026-10-01', end: '2026-10-21', kind: 'month', offsetDays: 31,
      });
    });
    it('crosses a year boundary', () => {
      expect(r('2026-01-01', '2026-01-15')).toMatchObject({
        start: '2025-12-01', end: '2025-12-15', kind: 'month',
      });
    });
    it('moves a full 30-day month to the full prior month', () => {
      expect(r('2026-06-01', '2026-06-30')).toMatchObject({
        start: '2026-05-01', end: '2026-05-31', kind: 'month',
      });
      expect(r('2026-11-01', '2026-11-30')).toMatchObject({
        start: '2026-10-01', end: '2026-10-31', kind: 'month',
      });
    });
    it('moves a full February to the full January', () => {
      expect(r('2026-02-01', '2026-02-28')).toMatchObject({
        start: '2026-01-01', end: '2026-01-31', kind: 'month',
      });
    });
    it('keeps day 30 for a month to date that ends on day 30', () => {
      expect(r('2026-01-01', '2026-01-30')).toMatchObject({
        start: '2025-12-01', end: '2025-12-30', kind: 'month',
      });
    });
    it('uses the month rule for Oct 1-31 with no hint', () => {
      expect(r('2026-10-01', '2026-10-31')).toMatchObject({
        start: '2026-09-01', end: '2026-09-30', kind: 'month',
      });
    });
  });

  describe('quarter', () => {
    it('compares a quarter to date', () => {
      expect(r('2026-10-01', '2026-11-21')).toMatchObject({
        start: '2026-07-01', end: '2026-08-21', kind: 'quarter',
      });
    });
    it('uses the hint for Oct 1-31', () => {
      expect(r('2026-10-01', '2026-10-31', 'quarter')).toMatchObject({
        start: '2026-07-01', end: '2026-07-31', kind: 'quarter',
      });
    });
    it('crosses a year boundary', () => {
      expect(r('2026-01-01', '2026-02-10')).toMatchObject({
        start: '2025-10-01', end: '2025-11-10', kind: 'quarter',
      });
    });
    it('moves a full Q2 to the full Q1', () => {
      expect(r('2026-04-01', '2026-06-30')).toMatchObject({
        start: '2026-01-01', end: '2026-03-31', kind: 'quarter',
      });
    });
    it('does not apply when the end is in a later quarter', () => {
      expect(r('2026-10-01', '2027-01-05')?.kind).toBe('shift');
    });
  });

  describe('hint limits the rules', () => {
    // 2026-06-01 and 2024-04-01 are Mondays.
    it('month hint skips the week rule on a Monday 1st', () => {
      expect(r('2026-06-01', '2026-06-03', 'month')).toMatchObject({
        start: '2026-05-01', end: '2026-05-03', kind: 'month',
      });
    });
    it('quarter hint skips the week rule on a Monday quarter start', () => {
      expect(r('2024-04-01', '2024-04-03', 'quarter')).toMatchObject({
        start: '2024-01-01', end: '2024-01-03', kind: 'quarter',
      });
    });
    it('no hint keeps the week rule on a Monday 1st', () => {
      expect(r('2026-06-01', '2026-06-03')).toMatchObject({
        start: '2026-05-25', end: '2026-05-27', kind: 'week',
      });
    });
    it('week hint uses the week rule', () => {
      expect(r('2026-06-01', '2026-06-03', 'week')?.kind).toBe('week');
    });
  });

  describe('shift', () => {
    it('moves 1 day back to the same weekday last week', () => {
      expect(r('2026-11-21', '2026-11-21')).toEqual({
        start: '2026-11-14', end: '2026-11-14', kind: 'shift', offsetDays: 7,
      });
    });
    it('moves a 30-day range back 35 days', () => {
      const out = r('2026-10-23', '2026-11-21');
      expect(out).toMatchObject({ kind: 'shift', offsetDays: 35 });
      expect(out?.start).toBe('2026-09-18');
      expect(out?.end).toBe('2026-10-17');
    });
    it('moves a 90-day range back 91 days', () => {
      const out = r('2026-08-24', '2026-11-21');
      expect(out?.offsetDays).toBe(91);
    });
    it('keeps the weekday of the start', () => {
      const out = r('2026-10-23', '2026-11-21')!;
      const wd = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
      expect(wd(out.start)).toBe(wd('2026-10-23'));
    });
    it('uses a 21-day shift for a shift hint on Nov 1-21', () => {
      expect(r('2026-11-01', '2026-11-21', 'shift')).toEqual({
        start: '2026-10-11', end: '2026-10-31', kind: 'shift', offsetDays: 21,
      });
    });
    it('shifts a Monday-start week by 7 with a shift hint', () => {
      expect(r('2026-11-16', '2026-11-22', 'shift')).toMatchObject({
        kind: 'shift', offsetDays: 7, start: '2026-11-09',
      });
    });
    it('uses the shift rule for a range that is not aligned', () => {
      expect(r('2026-11-05', '2026-11-11')?.kind).toBe('shift');
    });
  });

  describe('invalid input', () => {
    it.each([
      ['', '2026-11-21'],
      ['2026-11-21', ''],
      ['2026-02-31', '2026-03-05'],
      ['2026-13-01', '2026-13-05'],
      ['2026-11-22', '2026-11-21'],
      ['11/21/2026', '11/22/2026'],
    ])('returns null for %s -> %s', (s, e) => {
      expect(getComparisonRange(s, e)).toBeNull();
    });
  });
});

describe('describeComparison and comparisonLabel', () => {
  it('describes week, month, and quarter', () => {
    expect(describeComparison(r('2026-11-16', '2026-11-21')!)).toBe('same days, last week');
    expect(describeComparison(r('2026-11-01', '2026-11-21')!)).toBe('same days, last month');
    expect(describeComparison(r('2026-10-01', '2026-11-21')!)).toBe('same days, last quarter');
  });
  it('describes a 1-day shift', () => {
    expect(describeComparison(r('2026-11-21', '2026-11-21')!)).toBe('same day, last week');
  });
  it('describes 1 week and 5 weeks', () => {
    expect(describeComparison(r('2026-11-05', '2026-11-11')!)).toBe('1 week earlier');
    expect(describeComparison(r('2026-10-23', '2026-11-21')!)).toBe('5 weeks earlier');
  });
  it('builds the card label', () => {
    expect(comparisonLabel(r('2026-11-16', '2026-11-21')!)).toBe('vs same days, last week');
    expect(comparisonLabel(r('2026-11-21', '2026-11-21')!)).toBe('vs same day, last week');
    expect(comparisonLabel(r('2026-10-23', '2026-11-21')!)).toBe('vs 5 weeks earlier');
  });
});

describe('periodComparison', () => {
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  it('maps a partial week to the same days last week', () => {
    const out = periodComparison({
      type: 'week',
      from: new Date(2026, 10, 16),
      to: new Date(2026, 10, 21, 15, 30),
    });
    expect(out).not.toBeNull();
    expect(ymd(out!.from)).toBe('2026-11-09');
    expect(ymd(out!.to)).toBe('2026-11-14');
    expect(out!.from.getHours()).toBe(0);
    expect(out!.to.getHours()).toBe(23);
    expect(out!.to.getMinutes()).toBe(59);
    expect(out!.to.getSeconds()).toBe(59);
    expect(out!.to.getMilliseconds()).toBe(999);
    expect(out!.label).toBe('vs same days, last week');
  });

  it('maps today to the same weekday last week', () => {
    const out = periodComparison({
      type: 'today',
      from: new Date(2026, 10, 21),
      to: new Date(2026, 10, 21),
    });
    expect(ymd(out!.from)).toBe('2026-11-14');
    expect(ymd(out!.to)).toBe('2026-11-14');
    expect(out!.label).toBe('vs same day, last week');
  });

  it('uses the shift rule for last30 that starts on the 1st', () => {
    const out = periodComparison({
      type: 'last30',
      from: new Date(2026, 10, 1),
      to: new Date(2026, 10, 30),
    });
    // 30 days rounds up to 35 days.
    expect(ymd(out!.from)).toBe('2026-09-27');
    expect(ymd(out!.to)).toBe('2026-10-26');
    expect(out!.label).toBe('vs 5 weeks earlier');
  });

  it('maps the quarter preset on a one-month range to the prior quarter', () => {
    const out = periodComparison({
      type: 'quarter',
      from: new Date(2026, 9, 1),
      to: new Date(2026, 9, 31),
    });
    expect(ymd(out!.from)).toBe('2026-07-01');
    expect(ymd(out!.to)).toBe('2026-07-31');
    expect(out!.label).toBe('vs same days, last quarter');
  });

  it('maps the month preset on Mon Jun 1 to the prior month', () => {
    const out = periodComparison({
      type: 'month',
      from: new Date(2026, 5, 1),
      to: new Date(2026, 5, 3),
    });
    expect(ymd(out!.from)).toBe('2026-05-01');
    expect(ymd(out!.to)).toBe('2026-05-03');
    expect(out!.label).toBe('vs same days, last month');
  });

  it('keeps local day bounds across the March DST change', () => {
    // Mon Mar 9 to Sun Mar 15, 2026. The prior week holds Sun Mar 8, the US DST start.
    const out = periodComparison({
      type: 'week',
      from: new Date(2026, 2, 9),
      to: new Date(2026, 2, 15, 23, 59, 59, 999),
    });
    expect(ymd(out!.from)).toBe('2026-03-02');
    expect(ymd(out!.to)).toBe('2026-03-08');
    expect(out!.from.getHours()).toBe(0);
    expect(out!.from.getMinutes()).toBe(0);
    expect(out!.to.getHours()).toBe(23);
    expect(out!.to.getMinutes()).toBe(59);
  });

  it('keeps local day bounds across the November DST change', () => {
    // Sun Nov 1, 2026 is the US DST end. Mon Nov 2 to Sun Nov 8 compares to Oct 26 to Nov 1.
    const out = periodComparison({
      type: 'week',
      from: new Date(2026, 10, 2),
      to: new Date(2026, 10, 8),
    });
    expect(ymd(out!.from)).toBe('2026-10-26');
    expect(ymd(out!.to)).toBe('2026-11-01');
    expect(out!.from.getHours()).toBe(0);
    expect(out!.to.getHours()).toBe(23);
  });

  it('returns null for an invalid range', () => {
    expect(
      periodComparison({ type: 'custom', from: new Date(2026, 10, 21), to: new Date(2026, 10, 1) }),
    ).toBeNull();
  });
});

describe('previousPeriodQuery', () => {
  it('sends the prior range and the restaurant id', () => {
    const out = previousPeriodQuery(
      { type: 'week', from: new Date(2026, 10, 16), to: new Date(2026, 10, 21) },
      'rest-1',
    );
    expect(out.restaurantId).toBe('rest-1');
    expect(toDateOnly(out.from)).toBe('2026-11-09');
    expect(toDateOnly(out.to)).toBe('2026-11-14');
    expect(out.label).toBe('vs same days, last week');
  });

  it('turns off the query when no prior range exists', () => {
    const from = new Date(2026, 10, 21);
    const to = new Date(2026, 10, 1);
    const out = previousPeriodQuery({ type: 'custom', from, to }, 'rest-1');
    expect(out).toEqual({ restaurantId: null, from, to, label: 'vs previous period' });
  });

  it('keeps a null restaurant id', () => {
    const out = previousPeriodQuery(
      { type: 'today', from: new Date(2026, 10, 21), to: new Date(2026, 10, 21) },
      null,
    );
    expect(out.restaurantId).toBeNull();
    expect(out.label).toBe('vs same day, last week');
  });
});

describe('week hint', () => {
  it('uses a 7-day shift for a non-Monday start on the 1st', () => {
    // Sun Nov 1 to Sat Nov 7, 2026.
    expect(r('2026-11-01', '2026-11-07', 'week')).toMatchObject({ kind: 'shift', offsetDays: 7 });
  });
});
