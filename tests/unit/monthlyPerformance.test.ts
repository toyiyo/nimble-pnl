/**
 * Monthly Performance Tests
 *
 * Tests the single source of truth for the dashboard's Monthly Performance
 * table. An April 2026 regression fixture (added in Task 6) will pin the
 * exact numbers the UI renders.
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

describe('calculateMonthlyPerformance — costs', () => {
  it('passes food cost through as cogsCents', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 0, foodCost: 25562, actualLaborCost: 0 },
      })
    );
    expect(result.cogsCents).toBe(2556200);
  });

  it('passes actual labor (incl. payroll taxes already in source) through', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 0, foodCost: 0, actualLaborCost: 32959 },
        pendingLabor: 16528,
      })
    );
    expect(result.actualLaborCents).toBe(3295900);
    expect(result.pendingLaborCents).toBe(1652800);
    expect(result.laborIncludingPendingCents).toBe(4948700);
  });

  it('computes other expenses as actualExpenses - cogs - actualLabor (no pending labor)', () => {
    const baseInput = makeInput({
      expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
      pendingLabor: 16528,
    });
    const result = calculateMonthlyPerformance(baseInput);
    expect(result.actualExpensesCents).toBe(11122000);
    expect(result.otherExpensesCents).toBe(5269900); // 111220 - 25562 - 32959

    // otherExpenses must be invariant under pendingLabor changes — if pending
    // labor leaked into otherExpenses, varying it would shift the result.
    const noPending = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 0,
      })
    );
    const morePending = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
        pendingLabor: 99999,
      })
    );
    expect(noPending.otherExpensesCents).toBe(result.otherExpensesCents);
    expect(morePending.otherExpensesCents).toBe(result.otherExpensesCents);
  });

  it('floors otherExpenses at 0 when subtraction would go negative (rounding edge)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 100, foodCost: 60, actualLaborCost: 50 },
      })
    );
    expect(result.otherExpensesCents).toBe(0);
  });

  it('computes projectedExpenses as actualExpenses + pendingLabor', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 16528,
      })
    );
    expect(result.projectedExpensesCents).toBe(11122000 + 1652800);
  });
});

describe('calculateMonthlyPerformance — profit', () => {
  it('actualNetProfit = netRevenue - actualExpenses', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 73019,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
      })
    );
    expect(result.actualNetProfitCents).toBe(7301900 - 11122000); // -3,820,100
  });

  it('projectedNetProfit = netRevenue - projectedExpenses (subtracts pending labor)', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 73019,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 111220, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 16528,
      })
    );
    expect(result.projectedNetProfitCents).toBe(7301900 - 11122000 - 1652800); // -5,472,900
  });

  it('projectedNetProfit equals actualNetProfit when pendingLabor is 0', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 0, discounts: 0, netRevenue: 50000,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 0,
        },
        expenses: { totalExpenses: 30000, foodCost: 0, actualLaborCost: 0 },
        pendingLabor: 0,
      })
    );
    expect(result.actualNetProfitCents).toBe(result.projectedNetProfitCents);
  });
});

describe('calculateMonthlyPerformance — POS reconciliation', () => {
  it('delta is null when no posReportedTotal is supplied', () => {
    const result = calculateMonthlyPerformance(makeInput());
    expect(result.posReportedCents).toBeNull();
    expect(result.posReconciliationDeltaCents).toBeNull();
  });

  it('delta is 0 when posReportedTotal equals derived POS', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100, discounts: 0, netRevenue: 100,
          salesTax: 8, tips: 5, otherLiabilities: 2, totalCollectedAtPos: 115,
        },
        posReportedTotal: 115,
      })
    );
    expect(result.posReconciliationDeltaCents).toBe(0);
  });

  it('delta is signed when posReportedTotal differs from derived POS', () => {
    const result = calculateMonthlyPerformance(
      makeInput({
        revenue: {
          grossRevenue: 100, discounts: 0, netRevenue: 100,
          salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 100,
        },
        posReportedTotal: 105,
      })
    );
    expect(result.posReconciliationDeltaCents).toBe(500); // posReported - derived
  });
});

describe('calculateMonthlyPerformance — decimal safety + idempotence', () => {
  it('100 inputs of $0.01 sum to exactly $1.00 in cents', () => {
    let totalCents = 0;
    for (let i = 0; i < 100; i++) {
      totalCents += toCents(0.01);
    }
    expect(totalCents).toBe(100); // exactly $1.00, not 100.00000000000007
  });

  it('returns identical results when called twice with the same input', () => {
    const input = makeInput({
      revenue: {
        grossRevenue: 74458, discounts: 1439, netRevenue: 73019,
        salesTax: 0, tips: 0, otherLiabilities: 0, totalCollectedAtPos: 74458,
      },
      expenses: { totalExpenses: 111220, foodCost: 25562, actualLaborCost: 32959 },
      pendingLabor: 16528,
    });
    const a = calculateMonthlyPerformance(input);
    const b = calculateMonthlyPerformance(input);
    expect(a).toEqual(b);
  });
});
