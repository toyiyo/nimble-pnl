import { useCallback, useMemo } from 'react';

import { buildSplhGrid } from '@/lib/splhAnalytics';
import { buildFinancialSeries, buildSalesVolumeGrid, summarizeLaborPnl } from '@/lib/laborPnlAnalytics';
import type { LaborGranularity } from '@/lib/laborPnlAnalytics';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

const WEEKS = 12; // covers month-granularity series + the hourly grid, mirroring useSplhAnalytics's WEEKS

/**
 * Full labor-P&L dataset for the `/labor` page (design §2.2, §5):
 * day/week/month `series`, the busy-hours `grid` (sales volume, a distinct
 * read from the SPLH efficiency heatmap), the period `summary`, and
 * `updateTarget` for the editable target-% control. See `useLaborPnlSummary`
 * for the lighter Dashboard-card variant that skips the grid. Both build on
 * the shared `useLaborPnlCore` (tz/target/sales+labor plumbing).
 */
export function useLaborPnlAnalytics(restaurantId: string | null, granularity: LaborGranularity) {
  const {
    tz,
    targetPct,
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

  const series = useMemo(
    () => buildFinancialSeries(dailySales, dailyLabor, granularity, targetPct),
    [dailySales, dailyLabor, granularity, targetPct],
  );

  const hasHourlyBreakdown = useMemo(() => sales.some((s) => !!s.sold_at), [sales]);

  const grid = useMemo(() => {
    // `buildSplhGrid`'s `target` param only feeds `SplhGridCell.state`
    // (an SPLH lean/balanced/slack read), which `buildSalesVolumeGrid`
    // deliberately discards (design §5: this grid colors by *sales volume*,
    // not staffing efficiency) — 0 keeps that unused classification inert
    // rather than feeding it a `%` target that isn't a $/labor-hour figure.
    const cells = buildSplhGrid(sales, sessions, tz, 0);
    return buildSalesVolumeGrid(cells, !hasHourlyBreakdown);
  }, [sales, sessions, tz, hasHourlyBreakdown]);

  const summary = useMemo(() => summarizeLaborPnl(series, targetPct), [series, targetPct]);

  // Dirty-checked write (design §7: "Enter+blur double-commit guarded by
  // dirty check") — only calls `updateSettings` when the value actually
  // changed, so a blur immediately after an Enter-triggered commit is a
  // no-op instead of firing the mutation twice.
  const updateTarget = useCallback(
    async (newTargetPct: number) => {
      if (newTargetPct === targetPct) return;
      await updateSettings({ target_labor_pct: newTargetPct });
    },
    [targetPct, updateSettings],
  );

  return {
    series,
    grid,
    summary,
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
