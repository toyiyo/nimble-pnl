/**
 * Daily labor cost as a percent of projected sales.
 *
 * The numerator is the cost of the shifts on the schedule (from
 * `useScheduledLaborCosts`). The denominator is the projected sales for the
 * weekday, from the same lookback-weeks history that the planner uses for its
 * hourly labor percent (`useWeekStaffingSuggestions`).
 */

export interface DailyLaborPercent {
  /** Scheduled labor cost for the day, in dollars. */
  laborCost: number;
  /** Projected sales for the day, in dollars. */
  projectedSales: number;
  /** Labor cost / projected sales × 100. `null` when there are no projected sales. */
  percent: number | null;
  /** True when `percent` is above the target labor percent. */
  overTarget: boolean;
}

export interface DailyLaborPercentInput {
  /** Days to compute, as `yyyy-MM-dd`. */
  weekDays: string[];
  dailyCosts: ReadonlyArray<{ date: string; total_labor_cost: number }>;
  /** Projected sales in dollars, keyed by `yyyy-MM-dd`. */
  projectedSalesByDay: ReadonlyMap<string, number>;
  targetLaborPct: number;
}

export function computeDailyLaborPercent({
  weekDays,
  dailyCosts,
  projectedSalesByDay,
  targetLaborPct,
}: DailyLaborPercentInput): Map<string, DailyLaborPercent> {
  const costByDay = new Map(dailyCosts.map((d) => [d.date, d.total_labor_cost]));
  const result = new Map<string, DailyLaborPercent>();

  for (const day of weekDays) {
    const laborCost = costByDay.get(day) ?? 0;
    const projectedSales = projectedSalesByDay.get(day) ?? 0;
    // Multiply first so exact ratios stay exact (300 / 1000 * 100 is 30.000000000000004).
    const percent = projectedSales > 0 ? (laborCost * 100) / projectedSales : null;
    result.set(day, {
      laborCost,
      projectedSales,
      percent,
      overTarget: percent !== null && percent > targetLaborPct,
    });
  }

  return result;
}
