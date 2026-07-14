import { describe, it, expect } from 'vitest';

import { computeActualSplh } from '@/hooks/useWeekStaffingSuggestions';

import type { TimePunch } from '@/types/timeTracking';

interface SaleFixture {
  total_price: number;
}

/** Builds a minimal-but-TimePunch-shaped fixture row. */
function punch(
  id: string,
  employee_id: string,
  punch_type: TimePunch['punch_type'] | 'in' | 'out',
  punch_time: string,
): TimePunch {
  return {
    id,
    restaurant_id: 'rest-1',
    employee_id,
    // `punch_type` is deliberately widened to include the legacy 'in'/'out'
    // values under test (§ regression: real DB values are
    // clock_in/clock_out/break_start/break_end) — cast narrows back to the
    // TimePunch union since `identifyWorkSessions` just no-ops on unknown types.
    punch_type: punch_type as TimePunch['punch_type'],
    punch_time,
  };
}

describe('computeActualSplh', () => {
  it('computes actual SPLH from clock_in/clock_out punches', () => {
    const sales: SaleFixture[] = [{ total_price: 600 }];
    const punches: TimePunch[] = [
      punch('p1', 'e1', 'clock_in', '2026-07-01T17:00:00Z'),
      punch('p2', 'e1', 'clock_out', '2026-07-01T21:00:00Z'),
    ];
    expect(computeActualSplh(sales, punches)).toBe(150); // 600 / 4h
  });

  it('returns null when punches use no recognized types', () => {
    const sales: SaleFixture[] = [{ total_price: 100 }];
    const punches: TimePunch[] = [punch('p1', 'e', 'in', '2026-07-01T17:00:00Z')];
    expect(computeActualSplh(sales, punches)).toBeNull();
  });

  it('returns null when there is no sales or punch data', () => {
    expect(computeActualSplh([], [])).toBeNull();
    expect(computeActualSplh([{ total_price: 100 }], [])).toBeNull();
    expect(
      computeActualSplh([], [punch('p1', 'e', 'clock_in', '2026-07-01T17:00:00Z')]),
    ).toBeNull();
  });

  it('sums hours across multiple employees and ignores unmatched clock_out', () => {
    const sales: SaleFixture[] = [{ total_price: 300 }, { total_price: 300 }];
    const punches: TimePunch[] = [
      punch('p1', 'e1', 'clock_in', '2026-07-01T09:00:00Z'),
      punch('p2', 'e1', 'clock_out', '2026-07-01T12:00:00Z'), // 3h
      punch('p3', 'e2', 'clock_in', '2026-07-01T09:00:00Z'),
      punch('p4', 'e2', 'clock_out', '2026-07-01T12:00:00Z'), // 3h
      punch('p5', 'e3', 'clock_out', '2026-07-01T12:00:00Z'), // no matching clock_in, ignored
    ];
    // total hours = 6h, total sales = 600 -> 100/h
    expect(computeActualSplh(sales, punches)).toBe(100);
  });

  it('excludes break time from worked hours (break-aware, unlike the old hand-rolled pairing)', () => {
    const sales: SaleFixture[] = [{ total_price: 400 }];
    const punches: TimePunch[] = [
      punch('p1', 'e1', 'clock_in', '2026-07-01T09:00:00Z'),
      punch('p2', 'e1', 'break_start', '2026-07-01T11:00:00Z'),
      punch('p3', 'e1', 'break_end', '2026-07-01T11:30:00Z'), // 30min break excluded
      punch('p4', 'e1', 'clock_out', '2026-07-01T13:00:00Z'),
    ];
    // total worked = 4h - 0.5h break = 3.5h, total sales = 400 -> ~114/h
    expect(computeActualSplh(sales, punches)).toBe(Math.round(400 / 3.5));
  });
});
