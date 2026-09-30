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
const MAX_SHOWN_LABOR_PERCENT = 999;

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
 * are partial. When `truncated` is true, the query stopped at its row cap and
 * the last date (rows are in date order) is partial, so it does not count.
 */
export function projectDailySales(
  rows: ReadonlyArray<{ sale_date: string; total_price: number | string | null }>,
  weekDays: string[],
  { excludeDate, truncated = false }: { excludeDate?: string; truncated?: boolean } = {},
): Map<string, number> {
  const partialDate = truncated ? rows.at(-1)?.sale_date : undefined;
  const totalByDate = new Map<string, number>();
  for (const row of rows) {
    if (row.sale_date === excludeDate || row.sale_date === partialDate) continue;
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

/** The percent as shown: "24%" or ">999%". */
function formatPercentValue(percent: number): string {
  const rounded = Math.round(percent);
  if (rounded > MAX_SHOWN_LABOR_PERCENT) return `>${MAX_SHOWN_LABOR_PERCENT}%`;
  return `${rounded}%`;
}

/** Header text for a day: "Labor 24%", "Labor >999%" or "Labor —". */
export function formatDailyLaborPercent(value: DailyLaborPercent | undefined): string {
  if (!value || value.percent === null) return 'Labor —';
  return `Labor ${formatPercentValue(value.percent)}`;
}

const DOLLARS = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/**
 * Full sentence for screen readers. With a `dayLabel` it starts "Mon, Sep 28
 * labor cost:"; with an empty `dayLabel` (the label already names the day) it
 * starts "Labor cost:".
 */
export function describeDailyLaborPercent(
  value: DailyLaborPercent | undefined,
  dayLabel: string,
  view: Pick<DailyLaborPercentView, 'hasError' | 'targetLaborPct' | 'lookbackWeeks'>,
): string {
  const prefix = dayLabel ? `${dayLabel} labor cost` : 'Labor cost';
  if (view.hasError) {
    return `${prefix}: could not load projected sales.`;
  }
  if (!value || value.percent === null) {
    return `${prefix}: no projected sales. No sales history for this weekday in the last ${view.lookbackWeeks} weeks.`;
  }
  const target = value.overTarget
    ? `over the ${view.targetLaborPct}% target`
    : `target ${view.targetLaborPct}%`;
  return `${prefix}: ${formatPercentValue(value.percent)} of projected sales. ${DOLLARS.format(value.laborCost)} scheduled, ${DOLLARS.format(value.projectedSales)} projected sales, ${target}.`;
}

export function formatDollars(value: number): string {
  return DOLLARS.format(value);
}
