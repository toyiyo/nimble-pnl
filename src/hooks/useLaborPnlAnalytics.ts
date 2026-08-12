import { useCallback, useMemo } from 'react';

import {
  buildFinancialSeries,
  buildSalesVolumeGrid,
  extractBalanceWindows,
  resolveDateRange,
  salesGridCellsFromRpc,
  seriesGranularityForRange,
  summarizeLaborPnl,
} from '@/lib/laborPnlAnalytics';
import type { LaborRangeSelection } from '@/lib/laborPnlAnalytics';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';
import { useLaborIntradaySeries } from '@/hooks/useLaborIntradaySeries';

/** Fixed lookback for the daily/grid aggregate (design §5.1). */
const WEEKS = 18;

/**
 * Read model for the `/labor` page. Selects a date range from the 18-week
 * daily aggregate for the KPI row and the day/week chart, and delegates the
 * single-day (intraday) chart to `useLaborIntradaySeries`. The busy-hours grid
 * comes from the SQL (dow, hour) aggregate via `salesGridCellsFromRpc`.
 */
export function useLaborPnlAnalytics(restaurantId: string | null, selection: LaborRangeSelection) {
  const {
    tz,
    targetPct,
    todayStr,
    dailySales,
    dailyLabor,
    grid: coreGrid,
    byWeekday,
    hasHourly,
    capped,
    hasData,
    isLoading,
    isError,
    error,
    refetch,
    updateSettings,
    isSavingTarget,
  } = useLaborPnlCore(restaurantId, WEEKS);

  const range = useMemo(() => resolveDateRange(selection, todayStr), [selection, todayStr]);
  const granularity = useMemo(
    () => seriesGranularityForRange(range.startStr, range.endStr),
    [range],
  );
  const isIntraday = granularity === 'intraday';

  // Intraday (Day view) series comes from its own lazy single-day fetch (design
  // §9). The hook always runs (React rules) but fetches only when enabled.
  const intraday = useLaborIntradaySeries(restaurantId, tz, range.endStr, targetPct, isIntraday);

  const periodSales = useMemo(
    () => dailySales.filter((p) => p.bucketStart >= range.startStr && p.bucketStart <= range.endStr),
    [dailySales, range],
  );
  const periodLabor = useMemo(
    () => dailyLabor.filter((d) => d.date >= range.startStr && d.date <= range.endStr),
    [dailyLabor, range],
  );

  const periodDaily = useMemo(
    () => buildFinancialSeries(periodSales, periodLabor, 'day', targetPct),
    [periodSales, periodLabor, targetPct],
  );
  const summary = useMemo(() => summarizeLaborPnl(periodDaily, targetPct), [periodDaily, targetPct]);

  const series = useMemo(() => {
    if (isIntraday) return intraday.series;
    if (granularity === 'day') return periodDaily;
    return buildFinancialSeries(periodSales, periodLabor, 'week', targetPct);
  }, [isIntraday, granularity, intraday.series, periodDaily, periodSales, periodLabor, targetPct]);

  const overWindows = useMemo(() => extractBalanceWindows(series, 'over'), [series]);
  const underWindows = useMemo(() => extractBalanceWindows(series, 'under'), [series]);

  const grid = useMemo(
    () => buildSalesVolumeGrid(salesGridCellsFromRpc(coreGrid, byWeekday, hasHourly), !hasHourly),
    [coreGrid, byWeekday, hasHourly],
  );

  const updateTarget = useCallback(
    async (newTargetPct: number) => {
      if (newTargetPct === targetPct) return;
      await updateSettings({ target_labor_pct: newTargetPct });
    },
    [targetPct, updateSettings],
  );

  // Retry must cover whichever fetch actually failed. `refetch` from
  // `useLaborPnlCore` only re-runs the 18-week sales/labor aggregate; it does
  // not touch the intraday hook's own single-day query. Without this, a
  // failed Day-view fetch put the page in the error state (isError below) but
  // the page's Retry button did nothing.
  //
  // Depend on the leaf `intradayRefetch` function, not the `intraday` object:
  // `useLaborIntradaySeries` returns a fresh object every render, so
  // depending on the whole object would recreate `refetchAll` every render.
  const { refetch: intradayRefetch } = intraday;
  const refetchAll = useCallback(() => {
    refetch();
    if (isIntraday) intradayRefetch();
  }, [refetch, isIntraday, intradayRefetch]);

  return {
    series,
    granularity,
    seriesIsShapeEstimate: isIntraday,
    range,
    todayStr,
    grid,
    summary,
    overWindows,
    underWindows,
    targetPct,
    capped,
    hasData,
    isLoading: isLoading || (isIntraday && intraday.isLoading),
    isError: isError || (isIntraday && !!intraday.isError),
    error: error ?? (isIntraday ? (intraday.error ?? null) : null),
    refetch: refetchAll,
    updateTarget,
    isSavingTarget,
  };
}
