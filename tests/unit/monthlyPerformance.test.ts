/**
 * Monthly Performance Tests
 *
 * Tests the single source of truth for the dashboard's Monthly Performance
 * table. The April 2026 fixture below is the regression anchor — these
 * exact numbers must keep matching what the UI renders.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateMonthlyPerformance,
  toCents,
  type MonthlyPerformanceInput,
} from '../../supabase/functions/_shared/monthlyPerformance';

function makeInput(overrides?: Partial<MonthlyPerformanceInput>): MonthlyPerformanceInput {
  return {
    revenue: {
      grossRevenue: 0,
      discounts: 0,
      netRevenue: 0,
      salesTax: 0,
      tips: 0,
      otherLiabilities: 0,
      totalCollectedAtPos: 0,
    },
    expenses: {
      totalExpenses: 0,
      foodCost: 0,
      actualLaborCost: 0,
    },
    pendingLabor: 0,
    posReportedTotal: null,
    ...overrides,
  };
}

describe('toCents', () => {
  it('converts whole dollars exactly', () => {
    expect(toCents(100)).toBe(10000);
  });

  it('rounds half-away-from-zero', () => {
    expect(toCents(0.005)).toBe(1);
    expect(toCents(-0.005)).toBe(-1);
  });

  it('returns 0 for non-finite values', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });
});

describe('calculateMonthlyPerformance — revenue and pass-through', () => {
  it('converts gross / discounts / net to cents', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 74458,
          discounts: 1439,
          netRevenue: 73019,
          salesTax: 0,
          tips: 0,
          otherLiabilities: 0,
          totalCollectedAtPos: 74458,
        },
      })
    );
    expect(result.grossRevenueCents).toBe(7445800);
    expect(result.discountsCents).toBe(143900);
    expect(result.netRevenueCents).toBe(7301900);
  });

  it('sums pass-through total from tax + tips + other liabilities', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100,
          discounts: 0,
          netRevenue: 100,
          salesTax: 8,
          tips: 5,
          otherLiabilities: 2,
          totalCollectedAtPos: 115,
        },
      })
    );
    expect(result.salesTaxCents).toBe(800);
    expect(result.tipsCents).toBe(500);
    expect(result.otherLiabilitiesCents).toBe(200);
    expect(result.passThroughTotalCents).toBe(1500);
  });

  it('derives POS collected as gross + pass-through (ignoring caller-supplied totalCollectedAtPos)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100,
          discounts: 0,
          netRevenue: 100,
          salesTax: 8,
          tips: 5,
          otherLiabilities: 2,
          totalCollectedAtPos: 999, // intentionally wrong
        },
      })
    );
    expect(result.posCollectedFromBreakdownCents).toBe(11500);
  });
});
