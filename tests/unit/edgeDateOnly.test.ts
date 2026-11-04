import { describe, it, expect } from 'vitest';
import { toDateOnlyString } from '../../supabase/functions/_shared/dateOnly';
import { toDateOnlyString as toDateOnlyStringSrc } from '@/lib/dateOnly';

// This module re-exports `toDateOnlyString` from
// `supabase/functions/_shared/labor/dateOnly.ts`, which `src/lib/dateOnly.ts`
// also re-exports. This suite locks the edge path to the same behavior, so a
// later change cannot silently reintroduce the process-receipt /
// process-expense-invoice bug class (a calendar day serialized via UTC fields
// instead of local fields).

describe('toDateOnlyString (supabase/functions/_shared/dateOnly)', () => {
  it('serializes local calendar fields, not UTC fields', () => {
    // A local-field constructor: Jan 5 2024 at local midnight, regardless of
    // host TZ. If this ever regressed to `.toISOString().split('T')[0]`, a
    // host TZ east of UTC (e.g. Pacific/Auckland) would roll this back to
    // 2024-01-04.
    expect(toDateOnlyString(new Date(2024, 0, 5))).toBe('2024-01-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(toDateOnlyString(new Date(2026, 2, 4))).toBe('2026-03-04');
  });

  it('handles December 31 / year rollover', () => {
    expect(toDateOnlyString(new Date(2025, 11, 31))).toBe('2025-12-31');
  });

  it('handles leap-day Feb 29', () => {
    expect(toDateOnlyString(new Date(2024, 1, 29))).toBe('2024-02-29');
  });

  it('produces the same output as src/lib/dateOnly.ts for the same input', () => {
    const samples = [
      new Date(2024, 0, 1),
      new Date(2026, 5, 15),
      new Date(2025, 11, 31),
      new Date(2024, 1, 29),
    ];
    for (const d of samples) {
      expect(toDateOnlyString(d)).toBe(toDateOnlyStringSrc(d));
    }
  });
});
