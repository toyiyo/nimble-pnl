import type { OperatingCost, BreakEvenData, CostBreakdownItem } from '@/types/operatingCosts';

type BreakEvenStatus = 'above' | 'at' | 'below';

const BREAK_EVEN_TOLERANCE = 0.05;

function classifyDelta(delta: number, breakEven: number): BreakEvenStatus {
  if (breakEven === 0) return delta >= 0 ? 'above' : 'below';
  const threshold = breakEven * BREAK_EVEN_TOLERANCE;
  if (delta > threshold) return 'above';
  if (delta < -threshold) return 'below';
  return 'at';
}

interface DailySalesEntry {
  date: string;
  netRevenue: number;
  transactionCount: number;
}

/**
 * Pure function that computes break-even data from costs and sales.
 *
 * Grouping logic:
 * - entry_type='value' -> fixedCosts (regardless of cost_type)
 * - entry_type='percentage' -> variableCosts (regardless of cost_type)
 *
 * BEP formula:
 * - Total Variable % = sum of all percentage-based costs
 * - Contribution Margin = 1 - Total Variable %
 * - BEP = Total Fixed Costs / Contribution Margin
 */
export function calculateBreakEven(
  costs: OperatingCost[],
  salesData: DailySalesEntry[],
  autoUtilityCosts: number,
  todayStr: string,
): BreakEvenData {
  const avgDailySales =
    salesData.length > 0
      ? salesData.reduce((sum, d) => sum + d.netRevenue, 0) / salesData.length
      : 0;

  const todaySalesEntry = salesData.find((d) => d.date === todayStr);
  const todaySales = todaySalesEntry?.netRevenue ?? 0;

  const fixedItems: CostBreakdownItem[] = [];
  const variableItems: CostBreakdownItem[] = [];

  const autoUtilityItems = costs.filter(
    (c) => c.costType === 'semi_variable' && c.isAutoCalculated && !c.manualOverride,
  );
  const autoUtilityCount = autoUtilityItems.length;

  for (const cost of costs) {
    const isPercentage = cost.entryType === 'percentage';

    if (isPercentage) {
      const daily = avgDailySales * cost.percentageValue;
      variableItems.push({
        id: cost.id,
        name: cost.name,
        category: cost.category,
        daily,
        monthly: daily * 30,
        percentage: cost.percentageValue * 100,
        isPercentage: true,
        source: cost.manualOverride || !cost.isAutoCalculated ? 'manual' : 'calculated',
      });
    } else {
      let monthly: number;

      if (
        cost.costType === 'semi_variable' &&
        cost.isAutoCalculated &&
        !cost.manualOverride &&
        autoUtilityCosts > 0 &&
        autoUtilityCount > 0
      ) {
        monthly = autoUtilityCosts / 100 / autoUtilityCount;
      } else {
        monthly = cost.monthlyValue / 100;
      }

      const daily = monthly / 30;

      fixedItems.push({
        id: cost.id,
        name: cost.name,
        category: cost.category,
        daily,
        monthly,
        isPercentage: false,
        source: cost.manualOverride || !cost.isAutoCalculated ? 'manual' : 'calculated',
      });
    }
  }

  const fixedDaily = fixedItems.reduce((sum, i) => sum + i.daily, 0);
  const fixedMonthly = fixedItems.reduce((sum, i) => sum + i.monthly, 0);
  const fixedYearly = fixedMonthly * 12;

  const totalVariablePercent = variableItems.reduce(
    (sum, i) => sum + (i.percentage ?? 0) / 100,
    0,
  );
  const contributionMargin = 1 - totalVariablePercent;

  const monthlyBreakEven =
    contributionMargin > 0 ? fixedMonthly / contributionMargin : Infinity;
  const dailyBreakEven = monthlyBreakEven / 30;
  const yearlyBreakEven = monthlyBreakEven * 12;

  const variableDaily = variableItems.reduce((sum, i) => sum + i.daily, 0);

  const todayDelta = todaySales - dailyBreakEven;
  const todayStatus = classifyDelta(todayDelta, dailyBreakEven);

  const history = salesData.map((d) => {
    const delta = d.netRevenue - dailyBreakEven;
    return {
      date: d.date,
      sales: d.netRevenue,
      breakEven: dailyBreakEven,
      delta,
      status: classifyDelta(delta, dailyBreakEven),
    };
  });

  const aboveDays = history.filter((h) => h.status === 'above');
  const belowDays = history.filter((h) => h.status === 'below');

  return {
    dailyBreakEven,
    monthlyBreakEven,
    yearlyBreakEven,
    totalVariablePercent,
    contributionMargin,
    todaySales,
    todayStatus,
    todayDelta,
    fixedCosts: {
      items: fixedItems,
      totalDaily: fixedDaily,
      totalMonthly: fixedMonthly,
      totalYearly: fixedYearly,
    },
    variableCosts: {
      items: variableItems,
      totalDaily: variableDaily,
      avgDailySales: avgDailySales,
    },
    history,
    daysAbove: aboveDays.length,
    daysBelow: belowDays.length,
    avgSurplus:
      aboveDays.length > 0
        ? aboveDays.reduce((sum, h) => sum + h.delta, 0) / aboveDays.length
        : 0,
    avgShortfall:
      belowDays.length > 0
        ? belowDays.reduce((sum, h) => sum + h.delta, 0) / belowDays.length
        : 0,
  };
}
