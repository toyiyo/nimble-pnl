import { describe, it, expect } from 'vitest';
import { resolveLaborBasis } from '@/lib/combineCosts';

// Contract mirrored by useMonthlyMetrics' final labor_cost emission:
// emitted labor = accrued when the month has any punch labor, else paid.
function emittedLaborDollars(pendingDollars: number, actualDollars: number): number {
  return resolveLaborBasis(pendingDollars) === 'accrued' ? pendingDollars : actualDollars;
}

describe('useMonthlyMetrics labor_cost emission contract', () => {
  it('uses accrued (pending) when a month has punch labor — never the sum', () => {
    expect(emittedLaborDollars(200, 180)).toBe(200); // not 380
  });
  it('falls back to paid when no punch labor', () => {
    expect(emittedLaborDollars(0, 180)).toBe(180);
  });
  it('is zero only when both sources are zero (=== 0 guard unchanged)', () => {
    expect(emittedLaborDollars(0, 0)).toBe(0);
  });
});
