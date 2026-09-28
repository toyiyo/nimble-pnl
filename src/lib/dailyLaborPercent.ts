/**
 * Daily labor cost as a percent of projected sales.
 *
 * The numerator is the cost of the shifts on the schedule (from
 * `useScheduledLaborCosts`). The denominator is the projected sales for the
 * weekday, from the same lookback-weeks sales history that the planner uses
 * (`lookbackSalesQueryOptions`).
 */

import { dayStringToDow } from '@/lib/staffingApply';

export interface DailyLaborPercent {
  /** Scheduled labor cost for the day, in dollars. */
  laborCost: number;
  /** Projected sales for the day, in dollars. */
  projectedSales: number;
  /** Labor cost / projected sales × 100. `null` when there are no projected sales. */
  percent: number | null;
  /** True when the whole-number percent (as shown) is above the target. */
  overTarget: boolean;
}

/** What a day header needs to show the percent. */
export interface DailyLaborPercentView {
  byDay: ReadonlyMap<string, DailyLaborPercent>;
  isLoading: boolean;
  /** True when the sales history did not load. */
  hasError: boolean;
  targetLaborPct: number;
  lookbackWeeks: number;
}

export interface DailyLaborPercentInput {
  /** Days to compute, as `yyyy-MM-dd`. */
  weekDays: string[];
  dailyCosts: ReadonlyArray<{ date: string; total_labor_cost: number }>;
  /** Projected sales in dollars, keyed by `yyyy-MM-dd`. */
  projectedSalesByDay: ReadonlyMap<string, number>;
  targetLaborPct: number;
}

/** Percent values above this show as ">999%" so they fit a narrow header. */
export const MAX_SHOWN_LABOR_PERCENT = 999;

export function computeDailyLaborPercent({
  weekDays,
  dailyCosts,
  projectedSalesByDay,
  targetLaborPct,
}: DailyLaborPercentInput): Map<string, DailyLaborPercent> {
  const costByDay = new Map(dailyCosts.map((d) => [d.date, d.total_labor_cost]));
  const percentByDay = new Map<string, DailyLaborPercent>();

  for (const day of weekDays) {
    const laborCost = costByDay.get(day) ?? 0;
    const projectedSales = projectedSalesByDay.get(day) ?? 0;
    // Multiply first so exact ratios stay exact (300 / 1000 * 100 is 30.000000000000004).
    const percent = projectedSales > 0 ? (laborCost * 100) / projectedSales : null;
    percentByDay.set(day, {
      laborCost,
      projectedSales,
      percent,
      // Compare the shown (whole-number) value, so "22%" is never red at a 22% target.
      overTarget: percent !== null && Math.round(percent) > targetLaborPct,
    });
  }

  return percentByDay;
}

/**
 * Projected sales per day: the average daily sales total of the same weekday
 * in the lookback history.
 *
 * Each date's total is the sum of its sale rows. Dates with no sales (closed
 * days) do not count. `excludeDate` (today) does not count, because its sales
 * are partial.
 */
export function projectDailySales(
  rows: ReadonlyArray<{ sale_date: string; total_price: number | string | null }>,
  weekDays: string[],
  excludeDate?: string,
): Map<string, number> {
  const totalByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.sale_date === excludeDate) continue;
    const amount = Number(row.total_price) || 0;
    totalByDate.set(row.sale_date, (totalByDate.get(row.sale_date) ?? 0) + amount);
  }

  const sumByDow = new Map<number, { total: number; days: number }>();
  for (const [date, total] of totalByDate) {
    if (total <= 0) continue;
    const dow = dayStringToDow(date);
    const entry = sumByDow.get(dow) ?? { total: 0, days: 0 };
    entry.total += total;
    entry.days += 1;
    sumByDow.set(dow, entry);
  }

  const salesByDay = new Map<string, number>();
  for (const day of weekDays) {
    const entry = sumByDow.get(dayStringToDow(day));
    salesByDay.set(day, entry ? entry.total / entry.days : 0);
  }
  return salesByDay;
}

/** Header text for a day: "Labor 24%", "Labor >999%" or "Labor —". */
export function formatDailyLaborPercent(value: DailyLaborPercent | undefined): string {
  if (!value || value.percent === null) return 'Labor —';
  const rounded = Math.round(value.percent);
  if (rounded > MAX_SHOWN_LABOR_PERCENT) return `Labor >${MAX_SHOWN_LABOR_PERCENT}%`;
  return `Labor ${rounded}%`;
}

const DOLLARS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Full sentence for screen readers and for the day button `aria-label`. */
export function describeDailyLaborPercent(
  value: DailyLaborPercent | undefined,
  dayLabel: string,
  view: Pick<DailyLaborPercentView, 'hasError' | 'targetLaborPct' | 'lookbackWeeks'>,
): string {
  if (view.hasError) {
    return `${dayLabel} labor cost: could not load projected sales.`;
  }
  if (!value || value.percent === null) {
    return `${dayLabel} labor cost: no projected sales. No sales history for this weekday in the last ${view.lookbackWeeks} weeks.`;
  }
  const target = value.overTarget
    ? `over the ${view.targetLaborPct}% target`
    : `target ${view.targetLaborPct}%`;
  return `${dayLabel} labor cost: ${formatDailyLaborPercent(value).replace('Labor ', '')} of projected sales. ${DOLLARS.format(value.laborCost)} scheduled, ${DOLLARS.format(value.projectedSales)} projected sales, ${target}.`;
}

export function formatDollars(value: number): string {
  return DOLLARS.format(value);
}
