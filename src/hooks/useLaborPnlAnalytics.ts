import { useCallback, useMemo } from 'react';

import { buildSplhGrid, hourOfSale } from '@/lib/splhAnalytics';
import {
  buildFinancialSeries,
  buildIntradayFinancialSeries,
  buildSalesVolumeGrid,
  extractBalanceWindows,
  resolveDateRange,
  seriesGranularityForRange,
  summarizeLaborPnl,
} from '@/lib/laborPnlAnalytics';
import type { LaborRangeSelection } from '@/lib/laborPnlAnalytics';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { useEmployees } from '@/hooks/useEmployees';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

// Fetch window: wide enough for every preset (through "last month") plus a
// custom range up to ~4 months back. The selected range only *filters* this
// window, so the fetch size is fixed (no refetch when the range changes).
const WEEKS = 18;

/** Current hour (0–23) in the restaurant tz — used to cap "today" at "now". */
function currentHourInTz(tz: string): number {
  const value = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false })
    .formatToParts(new Date())
    .find((p) => p.type === 'hour')?.value;
  return value ? Number(value) % 24 : 23;
}

/**
 * Full labor-P&L dataset for the `/labor` page (design §2.2, §5).
 *
 * `selection` is a **date-range preset** (Today / This week / Last week / This
 * month / Last month / Custom). The KPI row + verdict always summarize the
 * range's **payroll-grade daily** series (design §4). The chart `series` shows
 * the range's natural sub-buckets (`seriesGranularityForRange`):
 *   - single day → hour-of-day (`buildIntradayFinancialSeries`; sub-day labor is
 *     an avg-rate *shape* estimate, design §9). When the day is **today**, the
 *     chart is capped at the current hour ("so far today").
 *   - ≤ ~2 weeks → by day.  •  longer → by week.
 *
 * Labor counts still-open shifts through "now" (see `useLaborPnlCore` /
 * `appendOpenShiftClockOuts`). The busy-hours `grid` intentionally spans the
 * full fetch window (a pattern, not the range's P&L).
 */
export function useLaborPnlAnalytics(restaurantId: string | null, selection: LaborRangeSelection) {
  const {
    tz,
    targetPct,
    todayStr,
    dailySales,
    dailyLabor,
    sales,
    sessions,
    capped,
    hasData,
    isLoading,
    isError,
    error,
    refetch,
    updateSettings,
    isSavingTarget,
  } = useLaborPnlCore(restaurantId, WEEKS);

  const { employees } = useEmployees(restaurantId);
  const avgHourlyRateCents = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const range = useMemo(() => resolveDateRange(selection, todayStr), [selection, todayStr]);
  const granularity = useMemo(
    () => seriesGranularityForRange(range.startStr, range.endStr),
    [range],
  );

  const periodSales = useMemo(
    () => dailySales.filter((p) => p.bucketStart >= range.startStr && p.bucketStart <= range.endStr),
    [dailySales, range],
  );
  const periodLabor = useMemo(
    () => dailyLabor.filter((d) => d.date >= range.startStr && d.date <= range.endStr),
    [dailyLabor, range],
  );

  // Authoritative (payroll-grade) daily series → drives the KPI row + verdict.
  const periodDaily = useMemo(
    () => buildFinancialSeries(periodSales, periodLabor, 'day', targetPct),
    [periodSales, periodLabor, targetPct],
  );
  const summary = useMemo(() => summarizeLaborPnl(periodDaily, targetPct), [periodDaily, targetPct]);

  // Chart series: intraday for a single day, by-day for a short range, by-week
  // for a long one. Cap "today" at the current hour so it reads "so far today".
  const series = useMemo(() => {
    if (granularity === 'intraday') {
      const capHour = range.endStr === todayStr ? currentHourInTz(tz) : undefined;
      return buildIntradayFinancialSeries(sales, sessions, tz, range.endStr, avgHourlyRateCents, targetPct, capHour);
    }
    if (granularity === 'day') return periodDaily;
    return buildFinancialSeries(periodSales, periodLabor, 'week', targetPct);
  }, [granularity, range, todayStr, sales, sessions, tz, avgHourlyRateCents, targetPct, periodDaily, periodSales, periodLabor]);

  const overWindows = useMemo(() => extractBalanceWindows(series, 'over'), [series]);
  const underWindows = useMemo(() => extractBalanceWindows(series, 'under'), [series]);

  const hasHourlyBreakdown = useMemo(() => sales.some((s) => hourOfSale(s, tz) !== null), [sales, tz]);

  const grid = useMemo(() => {
    const cells = buildSplhGrid(sales, sessions, tz, 0);
    return buildSalesVolumeGrid(cells, !hasHourlyBreakdown);
  }, [sales, sessions, tz, hasHourlyBreakdown]);

  const updateTarget = useCallback(
    async (newTargetPct: number) => {
      if (newTargetPct === targetPct) return;
      await updateSettings({ target_labor_pct: newTargetPct });
    },
    [targetPct, updateSettings],
  );

  return {
    series,
    /** Chart x-axis unit: 'intraday' | 'day' | 'week'. */
    granularity,
    /** True when the chart series is the avg-rate intraday shape (design §9). */
    seriesIsShapeEstimate: granularity === 'intraday',
    /** Resolved inclusive range bounds (for a range label). */
    range,
    /** Restaurant-tz "today" (for custom date-picker bounds). */
    todayStr,
    grid,
    summary,
    overWindows,
    underWindows,
    targetPct,
    capped,
    hasData,
    isLoading,
    isError,
    error,
    refetch,
    updateTarget,
    isSavingTarget,
  };
}
