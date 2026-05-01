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
 * Used by:
 * - Frontend: src/components/MonthlyBreakdownTable.tsx
 *
 * Pattern follows: supabase/functions/_shared/periodMetrics.ts
 */

// ===== TYPE DEFINITIONS =====

export interface MonthlyPerformanceInput {
  /** Revenue numbers from useMonthlyMetrics / useRevenueBreakdown (dollars). */
  revenue: {
    grossRevenue: number;
    discounts: number;
    /** Net after discounts AND refunds — caller must deduct both before passing. */
    netRevenue: number;
    salesTax: number;
    tips: number;
    otherLiabilities: number;
    /** NOT CONSUMED. The module re-derives POS-collected as
     *  grossRevenue + salesTax + tips + otherLiabilities. This field is
     *  accepted purely so callers can pass their hook's revenue shape via
     *  spread; the upstream value is intentionally ignored to guarantee
     *  the summary card and the breakdown read the same derived total. */
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
  // Math.round(-0.5) returns -0 in JS (not -1). The sign/abs pattern
  // gives true half-away-from-zero for negative values.
  return Math.sign(dollars) * Math.round(Math.abs(dollars) * 100);
}

// ===== MAIN FUNCTION =====

export function calculateMonthlyPerformance(
  input: MonthlyPerformanceInput
): MonthlyPerformanceResult {
  // Revenue
  const grossRevenueCents = toCents(input.revenue.grossRevenue);
  const discountsCents = toCents(input.revenue.discounts);
  const netRevenueCents = toCents(input.revenue.netRevenue);

  // Pass-through
  const salesTaxCents = toCents(input.revenue.salesTax);
  const tipsCents = toCents(input.revenue.tips);
  const otherLiabilitiesCents = toCents(input.revenue.otherLiabilities);
  const passThroughTotalCents =
    salesTaxCents + tipsCents + otherLiabilitiesCents;

  // POS — always derive from the breakdown (gross + pass-through), don't trust
  // the caller-supplied totalCollectedAtPos field. This is the rule that fixes
  // the $90,475 vs $87,332 mismatch: there is one POS number, sourced from
  // breakdown.
  const posCollectedFromBreakdownCents = grossRevenueCents + passThroughTotalCents;
  const posReportedCents =
    input.posReportedTotal == null ? null : toCents(input.posReportedTotal);
  const posReconciliationDeltaCents =
    posReportedCents == null ? null : posReportedCents - posCollectedFromBreakdownCents;

  return {
    grossRevenueCents,
    discountsCents,
    netRevenueCents,
    salesTaxCents,
    tipsCents,
    otherLiabilitiesCents,
    passThroughTotalCents,
    posCollectedFromBreakdownCents,
    posReportedCents,
    posReconciliationDeltaCents,
    // Costs + profit are placeholders until Tasks 3-4
    cogsCents: 0,
    actualLaborCents: 0,
    pendingLaborCents: 0,
    laborIncludingPendingCents: 0,
    otherExpensesCents: 0,
    actualExpensesCents: 0,
    projectedExpensesCents: 0,
    actualNetProfitCents: 0,
    projectedNetProfitCents: 0,
  };
}
