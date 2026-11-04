import { differenceInDays, subDays } from 'date-fns';
import { toDateOnlyString } from '@/lib/dateOnly';

/** One day of the `get_cash_flow_metrics` RPC's `daily` series. */
export interface DailyFlow {
  day: string;
  inflow: number;
  outflow: number;
}

export interface CashFlowMetrics {
  totalInflows: number;
  totalOutflows: number;
  netCashFlow: number;
  avgDailyCashFlow: number;
  volatility: number;
  trend: number[];
  trailingTrendPercentage: number;
}

/**
 * Turn the RPC's per-day totals into the metric set the UI shows.
 * Pure function: no fetch, no client state. `daily` covers the period
 * window only; days with no row are absent, not zero rows.
 */
export function deriveCashFlowMetrics(
  daily: DailyFlow[],
  comparisonInflow: number,
  startDate: Date,
  endDate: Date,
): CashFlowMetrics {
  const byDay = new Map<string, DailyFlow>();
  for (const row of daily) {
    byDay.set(row.day, row);
  }

  const periodDays = differenceInDays(endDate, startDate) + 1;

  const totalInflows = round2(daily.reduce((sum, row) => sum + row.inflow, 0));
  const totalOutflows = round2(daily.reduce((sum, row) => sum + row.outflow, 0));
  const netCashFlow = round2(totalInflows - totalOutflows);

  const avgDailyCashFlow = periodDays > 0 ? netCashFlow / periodDays : 0;

  // Volatility: population standard deviation of net daily flow, over the
  // days present in `daily` only — not the zero-filled trend window.
  const presentNetFlows = daily.map((row) => row.inflow - row.outflow);
  const volatility = populationStdDev(presentNetFlows);

  const trendDays = Math.min(14, periodDays);
  const trendKeys = lastNDayKeys(endDate, trendDays);
  const trend = trendKeys.map((key) => {
    const row = byDay.get(key);
    return row ? row.inflow - row.outflow : 0;
  });

  const trailingTrendPercentage =
    comparisonInflow > 0 ? ((totalInflows - comparisonInflow) / comparisonInflow) * 100 : 0;

  return {
    totalInflows,
    totalOutflows,
    netCashFlow,
    avgDailyCashFlow,
    volatility,
    trend,
    trailingTrendPercentage,
  };
}

/** The last `count` calendar-day keys ending at `endDate`, oldest first. */
function lastNDayKeys(endDate: Date, count: number): string[] {
  return Array.from({ length: count }, (_, i) => toDateOnlyString(subDays(endDate, count - 1 - i)));
}

function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
