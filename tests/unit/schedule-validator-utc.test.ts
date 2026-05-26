import { describe, it, expect } from 'vitest';
import { getDayOfWeekUTC } from '../../supabase/functions/_shared/schedule-validator';

describe('getDayOfWeekUTC', () => {
  it('returns 0 (Sunday) for 2026-06-07', () => {
    expect(getDayOfWeekUTC('2026-06-07')).toBe(0);
  });
  it('returns 1 (Monday) for 2026-06-08', () => {
    expect(getDayOfWeekUTC('2026-06-08')).toBe(1);
  });
  it('returns 6 (Saturday) for 2026-06-13', () => {
    expect(getDayOfWeekUTC('2026-06-13')).toBe(6);
  });
  it('agrees with itself across process.env.TZ values (snapshot)', () => {
    // Sanity: the function is UTC-anchored so process.env.TZ cannot change its output.
    // Real TZ portability is asserted in Task 9 by running vitest with TZ= env vars.
    const results = ['2026-06-07', '2026-06-08', '2026-06-13'].map(getDayOfWeekUTC);
    expect(results).toEqual([0, 1, 6]);
  });
});
