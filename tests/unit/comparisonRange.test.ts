import { describe, it, expect } from 'vitest';
import {
  getComparisonRange,
  describeComparison,
  comparisonLabel,
} from '@/lib/comparisonRange';

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
    it('does not apply when the end is in a later quarter', () => {
      expect(r('2026-10-01', '2027-01-05')?.kind).toBe('shift');
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
