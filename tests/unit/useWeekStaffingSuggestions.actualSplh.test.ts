import { describe, it, expect } from 'vitest';

import { computeActualSplh } from '@/hooks/useWeekStaffingSuggestions';

describe('computeActualSplh', () => {
  it('computes actual SPLH from clock_in/clock_out punches', () => {
    const sales = [{ total_price: 600 }];
    const punches = [
      { employee_id: 'e1', punch_type: 'clock_in', punch_time: '2026-07-01T17:00:00Z' },
      { employee_id: 'e1', punch_type: 'clock_out', punch_time: '2026-07-01T21:00:00Z' },
    ];
    expect(computeActualSplh(sales as any, punches as any)).toBe(150); // 600 / 4h
  });

  it('returns null when punches use no recognized types', () => {
    expect(
      computeActualSplh(
        [{ total_price: 100 }] as any,
        [{ employee_id: 'e', punch_type: 'in', punch_time: '2026-07-01T17:00:00Z' }] as any,
      ),
    ).toBeNull();
  });

  it('returns null when there is no sales or punch data', () => {
    expect(computeActualSplh([], [])).toBeNull();
    expect(computeActualSplh([{ total_price: 100 }] as any, [])).toBeNull();
    expect(
      computeActualSplh(
        [],
        [{ employee_id: 'e', punch_type: 'clock_in', punch_time: '2026-07-01T17:00:00Z' }] as any,
      ),
    ).toBeNull();
  });

  it('sums hours across multiple employees and ignores unmatched clock_out', () => {
    const sales = [{ total_price: 300 }, { total_price: 300 }];
    const punches = [
      { employee_id: 'e1', punch_type: 'clock_in', punch_time: '2026-07-01T09:00:00Z' },
      { employee_id: 'e1', punch_type: 'clock_out', punch_time: '2026-07-01T12:00:00Z' }, // 3h
      { employee_id: 'e2', punch_type: 'clock_in', punch_time: '2026-07-01T09:00:00Z' },
      { employee_id: 'e2', punch_type: 'clock_out', punch_time: '2026-07-01T12:00:00Z' }, // 3h
      { employee_id: 'e3', punch_type: 'clock_out', punch_time: '2026-07-01T12:00:00Z' }, // no matching clock_in, ignored
    ];
    // total hours = 6h, total sales = 600 -> 100/h
    expect(computeActualSplh(sales as any, punches as any)).toBe(100);
  });
});
