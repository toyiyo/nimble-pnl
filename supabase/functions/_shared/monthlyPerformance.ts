/**
 * Monthly Performance Shared Module
 *
 * Pure calculation functions for the dashboard's Monthly Performance table.
 * Single source of truth — Summary cards and detail rows must read the same
 * values produced here.
 *
 * All math is performed in integer cents to avoid floating-point drift.
 * Dollars in (Number), cents out (Number). The caller divides by 100 for display.
 *
 * Pattern follows: supabase/functions/_shared/periodMetrics.ts
 */

// ===== TYPE DEFINITIONS =====

export interface MonthlyPerformanceInput {
  /** Revenue numbers from useMonthlyMetrics / useRevenueBreakdown (dollars). */
  revenue: {
    grossRevenue: number;
    discounts: number;
    netRevenue: number;
    salesTax: number;
    tips: number;
    otherLiabilities: number;
    /** Already equals grossRevenue + salesTax + tips + otherLiabilities at the source. */
    totalCollectedAtPos: number;
  };
  /** Expense aggregates from useMonthlyExpenses for the same month (dollars). */
  expenses: {
    /** Bank-posted + scheduled-pending-outflow expenses (everything in the
     *  expense ledger). Does NOT include time-punch-derived pending labor. */
    totalExpenses: number;
    foodCost: number;
    actualLaborCost: number;
  };
  /** Time-punch-derived projected payroll not yet in the ledger (dollars). */
  pendingLabor: number;
  /** Optional external "POS reported" total (dollars). Today this is `null` —
   *  the field exists so a future feature can ingest a true POS gross-receipts
   *  number for cross-check. When provided and ≠ derived POS, the delta is
   *  exposed as `posReconciliationDeltaCents`. */
  posReportedTotal?: number | null;
}

export interface MonthlyPerformanceResult {
  // Revenue (cents)
  grossRevenueCents: number;
  discountsCents: number;
  netRevenueCents: number;

  // Pass-through (cents)
  salesTaxCents: number;
  tipsCents: number;
  otherLiabilitiesCents: number;
  passThroughTotalCents: number;

  // POS (cents)
  posCollectedFromBreakdownCents: number;
  posReportedCents: number | null;
  posReconciliationDeltaCents: number | null;

  // Costs (cents)
  cogsCents: number;
  actualLaborCents: number;
  pendingLaborCents: number;
  laborIncludingPendingCents: number;
  otherExpensesCents: number;
  actualExpensesCents: number;
  projectedExpensesCents: number;

  // Profit (cents)
  actualNetProfitCents: number;
  projectedNetProfitCents: number;
}

// ===== HELPERS =====

/** Convert a dollars-as-Number value to integer cents, rounding half-away-from-zero. */
export function toCents(dollars: number): number {
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

// ===== MAIN FUNCTION =====

export function calculateMonthlyPerformance(
  _input: MonthlyPerformanceInput
): MonthlyPerformanceResult {
  throw new Error('not implemented');
}
