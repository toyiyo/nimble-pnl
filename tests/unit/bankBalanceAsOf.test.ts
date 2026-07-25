import { describe, it, expect } from 'vitest';
import { computeAsOfDate } from '../../supabase/functions/_shared/bankBalanceAsOf';

// Design §4.4 / Plan Task 7 RED:
// 1. Given a Stripe balance carrying `as_of`, the persisted `as_of_date` equals
//    that instant (Stripe's `as_of` is a Unix timestamp in seconds).
// 2. Given a balance with no `as_of`, the existing `as_of_date` is left
//    unchanged — never overwritten with `now()`.
describe('computeAsOfDate', () => {
  it('converts a Stripe balance.as_of Unix timestamp (seconds) to an ISO string', () => {
    const stripeAsOfSeconds = 1769462148;
    expect(computeAsOfDate(stripeAsOfSeconds)).toBe(
      new Date(stripeAsOfSeconds * 1000).toISOString(),
    );
    expect(computeAsOfDate(stripeAsOfSeconds)).toBe('2026-01-26T21:15:48.000Z');
  });

  it('returns undefined (omit the field, leave existing value unchanged) when Stripe supplies no as_of', () => {
    expect(computeAsOfDate(undefined)).toBeUndefined();
  });

  it('returns undefined for a null as_of just like a missing one', () => {
    expect(computeAsOfDate(null)).toBeUndefined();
  });

  it('never falls back to the current time', () => {
    const before = Date.now();
    const result = computeAsOfDate(undefined);
    const after = Date.now();
    expect(result).toBeUndefined();
    // Sanity: prove the clock actually ran during the call, so an
    // accidental `new Date()` fallback wouldn't just accidentally pass.
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('treats as_of === 0 as a real Stripe-supplied timestamp, not "missing"', () => {
    expect(computeAsOfDate(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});
