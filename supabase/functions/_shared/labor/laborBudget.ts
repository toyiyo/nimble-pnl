import type { OperatingCost, BreakEvenData } from './breakEven.ts';

export type BudgetTier = 'success' | 'warning' | 'danger';
export type BudgetSource = 'sales' | 'breakeven' | 'fixed';

export interface LaborBudgetData {
  hasBudget: boolean;
  weeklyTarget: number;
  percentage: number;
  variance: number;
  tier: BudgetTier;
  source: BudgetSource | null;
  laborEntry: OperatingCost | null;
  isLoading: boolean;
}

/**
 * Pure calculation function — no hooks, easy to test.
 *
 * @param scheduledTotal - Total scheduled labor cost for the week ($)
 * @param costs - All operating cost entries for the restaurant
 * @param breakEvenData - Break-even analysis data (null if unavailable)
 */
export function calculateLaborBudget(
  scheduledTotal: number,
  costs: OperatingCost[],
  breakEvenData: BreakEvenData | null,
): LaborBudgetData {
  const laborEntry = costs.find((c) => c.category === 'labor') ?? null;

  const noBudget: LaborBudgetData = {
    hasBudget: false,
    weeklyTarget: 0,
    percentage: 0,
    variance: 0,
    tier: 'success',
    source: null,
    laborEntry,
    isLoading: false,
  };

  if (!laborEntry) return noBudget;

  let weeklyTarget: number;
  let source: BudgetSource;

  if (laborEntry.entryType === 'value') {
    // Fixed amount: monthlyValue is in cents
    const monthlyDollars = laborEntry.monthlyValue / 100;
    weeklyTarget = (monthlyDollars / 30) * 7;
    source = 'fixed';
  } else {
    // Percentage-based: need a daily sales figure
    const pct = laborEntry.percentageValue;
    const avgDailySales = breakEvenData?.variableCosts.avgDailySales ?? 0;

    if (avgDailySales > 0) {
      weeklyTarget = avgDailySales * pct * 7;
      source = 'sales';
    } else {
      // Fallback to break-even derived target
      const dailyBE = breakEvenData?.dailyBreakEven ?? 0;
      if (!isFinite(dailyBE) || dailyBE <= 0) return noBudget;
      weeklyTarget = dailyBE * pct * 7;
      source = 'breakeven';
    }
  }

  if (weeklyTarget <= 0) return noBudget;

  const percentage = (scheduledTotal / weeklyTarget) * 100;
  const variance = weeklyTarget - scheduledTotal;

  let tier: BudgetTier;
  if (percentage < 80) tier = 'success';
  else if (percentage <= 100) tier = 'warning';
  else tier = 'danger';

  return {
    hasBudget: true,
    weeklyTarget,
    percentage,
    variance,
    tier,
    source,
    laborEntry,
    isLoading: false,
  };
}
