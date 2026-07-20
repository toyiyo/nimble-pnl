import { describe, it, expect } from 'vitest';
import { classifyBalance, LABOR_BALANCE_BAND, monthKeyOf, bucketKeyOf } from '@/lib/laborPnlAnalytics';

describe('LABOR_BALANCE_BAND', () => {
  it('defaults to 6 percentage points', () => {
    expect(LABOR_BALANCE_BAND).toBe(6);
  });
});

describe('classifyBalance', () => {
  it('classifies over when labor% exceeds target+band', () => {
    expect(classifyBalance(28.01, 22, 6)).toBe('over');
  });

  it('classifies under when labor% is below target-band', () => {
    expect(classifyBalance(15.99, 22, 6)).toBe('under');
  });

  it('classifies balanced strictly within the band', () => {
    expect(classifyBalance(22, 22, 6)).toBe('balanced');
    expect(classifyBalance(25, 22, 6)).toBe('balanced');
    expect(classifyBalance(19, 22, 6)).toBe('balanced');
  });

  it('treats exactly target+band and target-band as balanced (inclusive edges)', () => {
    expect(classifyBalance(28, 22, 6)).toBe('balanced'); // target + band
    expect(classifyBalance(16, 22, 6)).toBe('balanced'); // target - band
  });

  it('defaults band to LABOR_BALANCE_BAND when omitted', () => {
    expect(classifyBalance(28, 22)).toBe('balanced');
    expect(classifyBalance(28.01, 22)).toBe('over');
  });

  it('guards targetPct<=0 as balanced regardless of laborPct', () => {
    expect(classifyBalance(50, 0)).toBe('balanced');
    expect(classifyBalance(50, -5)).toBe('balanced');
  });

  it('treats a null laborPct (no-sales bucket) as balanced, never over/under', () => {
    expect(classifyBalance(null, 22, 6)).toBe('balanced');
  });
});

describe('monthKeyOf', () => {
  it('returns the calendar-month key YYYY-MM for a mid-month date', () => {
    expect(monthKeyOf('2026-07-20')).toBe('2026-07');
  });

  it('returns the calendar-month key for the first and last day of a month', () => {
    expect(monthKeyOf('2026-07-01')).toBe('2026-07');
    expect(monthKeyOf('2026-07-31')).toBe('2026-07');
  });

  it('handles the Dec→Jan year boundary', () => {
    expect(monthKeyOf('2025-12-31')).toBe('2025-12');
    expect(monthKeyOf('2026-01-01')).toBe('2026-01');
  });
});

describe('bucketKeyOf', () => {
  it('passes the date through unchanged for day granularity', () => {
    expect(bucketKeyOf('2026-07-20', 'day')).toBe('2026-07-20');
  });

  it('buckets to the Monday of the week for week granularity (reusing mondayOf)', () => {
    // 2026-07-20 is a Monday.
    expect(bucketKeyOf('2026-07-20', 'week')).toBe('2026-07-20');
    // 2026-07-24 is a Friday in the same week.
    expect(bucketKeyOf('2026-07-24', 'week')).toBe('2026-07-20');
  });

  it('buckets to the calendar month for month granularity', () => {
    expect(bucketKeyOf('2026-07-24', 'month')).toBe('2026-07');
  });

  it('handles the Dec→Jan boundary consistently across all granularities', () => {
    expect(bucketKeyOf('2025-12-31', 'day')).toBe('2025-12-31');
    expect(bucketKeyOf('2025-12-31', 'month')).toBe('2025-12');
    // 2025-12-31 is a Wednesday; its Monday is 2025-12-29.
    expect(bucketKeyOf('2025-12-31', 'week')).toBe('2025-12-29');
  });
});
