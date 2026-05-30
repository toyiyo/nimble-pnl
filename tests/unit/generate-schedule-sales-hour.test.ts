/**
 * Tests for generate-schedule edge function: hourFromSale helper.
 *
 * The function should:
 * 1. Prefer sold_at (tz-aware) over sale_time when sold_at is present.
 * 2. Fall back to sale_time (local parse) when sold_at is null/absent.
 * 3. Use Intl.DateTimeFormat with hourCycle:'h23' so midnight = hour 0, not 24.
 * 4. Return -1 (skip) when neither sold_at nor sale_time is available.
 *
 * Day-of-week helper (dayOfWeekFromSaleDate) tested separately:
 * 5. Use noon-anchored parse `YYYY-MM-DDT12:00:00` to avoid UTC day-shift west of UTC.
 */
import { describe, it, expect } from 'vitest';
import { hourFromSale, dayOfWeekFromSaleDate } from '../../supabase/functions/_shared/sales-hour-utils';

describe('hourFromSale', () => {
  const TZ = 'America/Chicago';

  it('returns hour from sold_at in restaurant timezone (CDT offset)', () => {
    // 2026-05-30T01:30:00Z == 2026-05-29 20:30 CDT → hour 20
    const sale = { sale_date: '2026-05-29', sale_time: '23:15:00', sold_at: '2026-05-30T01:30:00.000Z', total_price: 100 };
    expect(hourFromSale(sale, TZ)).toBe(20);
  });

  it('falls back to sale_time when sold_at is null', () => {
    const sale = { sale_date: '2026-05-29', sale_time: '14:30:00', sold_at: null, total_price: 50 };
    expect(hourFromSale(sale, TZ)).toBe(14);
  });

  it('falls back to sale_time when sold_at is undefined', () => {
    const sale = { sale_date: '2026-05-29', sale_time: '09:00:00', total_price: 30 };
    expect(hourFromSale(sale, TZ)).toBe(9);
  });

  it('returns -1 when neither sold_at nor sale_time is present', () => {
    const sale = { sale_date: '2026-05-29', total_price: 10 };
    expect(hourFromSale(sale, TZ)).toBe(-1);
  });

  it('handles midnight correctly: sold_at midnight CDT → hour 0, not 24', () => {
    // 2026-05-30T05:00:00Z == 2026-05-30 00:00 CDT (midnight) → hour 0, not 24
    const sale = { sale_date: '2026-05-30', sale_time: '05:00:00', sold_at: '2026-05-30T05:00:00.000Z', total_price: 20 };
    expect(hourFromSale(sale, TZ)).toBe(0);
  });

  it('handles DST spring-forward boundary (Mar 8 2026): 08:00 UTC = 03:00 CDT', () => {
    // 2026-03-08T08:00:00Z → America/Chicago DST spring-forward day; 08:00 UTC = 03:00 CDT (post-jump)
    const sale = { sale_date: '2026-03-08', sale_time: '08:00:00', sold_at: '2026-03-08T08:00:00.000Z', total_price: 60 };
    expect(hourFromSale(sale, TZ)).toBe(3);
  });
});

describe('dayOfWeekFromSaleDate', () => {
  it('returns correct weekday for a Monday', () => {
    // 2026-06-01 is a Monday (dayOfWeek = 1)
    expect(dayOfWeekFromSaleDate('2026-06-01')).toBe(1);
  });

  it('returns Thursday (4) for 2026-01-01', () => {
    expect(dayOfWeekFromSaleDate('2026-01-01')).toBe(4);
  });

  it('returns Sunday (0) for 2026-06-07', () => {
    expect(dayOfWeekFromSaleDate('2026-06-07')).toBe(0);
  });

  it('returns Saturday (6) for 2026-05-30', () => {
    expect(dayOfWeekFromSaleDate('2026-05-30')).toBe(6);
  });
});
