import { describe, it, expect } from 'vitest';
import { computeOperatingCostTotals } from '../../supabase/functions/_shared/operatingCostMath';

const rows = [
  { cost_type: 'fixed', entry_type: 'value', monthly_value: 4037415, percentage_value: null },
  { cost_type: 'variable', entry_type: 'value', monthly_value: 8200, percentage_value: null },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 27 },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 3 },
  { cost_type: 'variable', entry_type: 'percentage', monthly_value: 0, percentage_value: 2.5 },
];

describe('computeOperatingCostTotals', () => {
  it('includes percentage items in the variable total (the July $82 bug)', () => {
    const t = computeOperatingCostTotals(rows, 72090.74);
    expect(t.variableFlatTotal).toBeCloseTo(82.0, 2);
    expect(t.variablePercentTotal).toBeCloseTo(72090.74 * 0.325, 2);
    expect(t.variableTotal).toBeGreaterThan(23000);
  });
  it('computes the variable ratio from percent items plus flat/revenue', () => {
    const t = computeOperatingCostTotals(rows, 72090.74);
    expect(t.variableCostPercentage).toBeCloseTo(32.5 + (82.0 / 72090.74) * 100, 4);
    expect(t.breakEvenRevenue).toBeCloseTo(40374.15 / ((100 - t.variableCostPercentage) / 100), 2);
  });
  it('falls back to 25 percent when the restaurant has no variable rows', () => {
    const t = computeOperatingCostTotals(rows.slice(0, 1), 1000);
    expect(t.variableCostPercentage).toBe(25);
  });
  it('does not divide by zero when netSales is 0', () => {
    const t = computeOperatingCostTotals(rows, 0);
    expect(Number.isFinite(t.breakEvenRevenue)).toBe(true);
    expect(t.variableCostPercentage).toBeCloseTo(32.5, 4);
  });
});
