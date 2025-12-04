/**
 * Monthly Metrics Shared Module
 * 
 * Pure calculation functions for monthly metrics classification.
 * These functions are designed to work in both Deno (Edge Functions) and Node.js (Frontend/Tests).
 * 
 * Used by:
 * - Frontend: src/hooks/useMonthlyMetrics.tsx
 * - Tests: tests/unit/monthlyMetrics.test.ts
 */

export type MonthlyMapMonth = {
  period: string;
  gross_revenue: number; // cents
  total_collected_at_pos: number; // cents
  net_revenue: number; // cents
  discounts: number; // cents
  refunds: number; // cents
  sales_tax: number; // cents
  tips: number; // cents
  other_liabilities: number; // cents
  food_cost: number; // cents
  labor_cost: number; // cents
  pending_labor_cost: number; // cents
  actual_labor_cost: number; // cents
  has_data: boolean;
};

export interface AdjustmentInput {
  total_price: number | null | undefined;
  adjustment_type: string | null;
  is_categorized: boolean;
  chart_account: {
    account_subtype: string | null;
    account_name: string | null;
  } | null;
}

/**
 * Classify an adjustment (tax, tip, fee, discount) into the appropriate
 * category within a monthly metrics object.
 * 
 * Classification priority:
 * 1. If categorized with chart_account, use account_subtype/account_name
 * 2. If uncategorized, fall back to adjustment_type
 * 
 * All amounts are converted to cents to avoid floating-point precision issues.
 */
export function classifyAdjustmentIntoMonth(
  month: MonthlyMapMonth,
  adjustment: AdjustmentInput
): void {
  const priceInCents = Math.round((adjustment.total_price || 0) * 100);
  const chart = adjustment.chart_account;
  const isCategorized = !!adjustment.is_categorized && !!chart;

  if (isCategorized && chart) {
    const subtype = (chart.account_subtype || '').toLowerCase();
    const accountName = (chart.account_name || '').toLowerCase();

    // Check for sales tax
    if ((subtype.includes('sales') && subtype.includes('tax')) || accountName.includes('tax')) {
      month.sales_tax += priceInCents;
      return;
    }
    
    // Check for tips
    if (subtype.includes('tip') || accountName.includes('tip')) {
      month.tips += priceInCents;
      return;
    }
    
    // Everything else is other liabilities
    month.other_liabilities += priceInCents;
    return;
  }

  // Un-categorized: fall back to adjustment_type
  switch (adjustment.adjustment_type) {
    case 'tax':
      month.sales_tax += priceInCents;
      break;
    case 'tip':
      month.tips += priceInCents;
      break;
    case 'service_charge':
    case 'fee':
      month.other_liabilities += priceInCents;
      break;
    case 'discount':
      month.discounts += Math.abs(priceInCents);
      break;
  }
}

/**
 * Create an empty month object with all values initialized to zero.
 * Useful for initializing new months in the monthly map.
 */
export function createEmptyMonth(period: string): MonthlyMapMonth {
  return {
    period,
    gross_revenue: 0,
    total_collected_at_pos: 0,
    net_revenue: 0,
    discounts: 0,
    refunds: 0,
    sales_tax: 0,
    tips: 0,
    other_liabilities: 0,
    food_cost: 0,
    labor_cost: 0,
    pending_labor_cost: 0,
    actual_labor_cost: 0,
    has_data: false,
  };
}
