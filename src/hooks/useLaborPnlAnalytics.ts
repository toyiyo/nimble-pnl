import { useCallback, useMemo } from 'react';

import { buildSplhGrid } from '@/lib/splhAnalytics';
import {
  buildFinancialSeries,
  buildIntradayFinancialSeries,
  buildSalesVolumeGrid,
  currentPeriodWindow,
  dateInWindow,
  extractBalanceWindows,
  summarizeLaborPnl,
} from '@/lib/laborPnlAnalytics';
import type { LaborGranularity } from '@/lib/laborPnlAnalytics';
import { getTodayInTimezone } from '@/lib/timezone';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { useEmployees } from '@/hooks/useEmployees';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

const WEEKS = 12; // covers month-granularity series + the hourly grid, mirroring useSplhAnalytics's WEEKS

/**
 * Full labor-P&L dataset for the `/labor` page (design §2.2, §5).
 *
 * The Day/Week/Month toggle is a **period selector**, not just a re-bucketing
 * of one fixed window (Phase-7 review fix): the KPI row, verdict, chart, and
 * staffing callouts all describe **today / this week / this month**. The
 * `summary` (KPI row + verdict) is always summed from the period's
 * **payroll-grade daily** series (design §4), so its labor $ / labor % stay
 * authoritative regardless of granularity. The chart `series` shows the
 * period's natural sub-buckets:
 *   - **Day** → hour-of-day (`buildIntradayFinancialSeries`; sub-day labor is an
 *     avg-rate *shape* estimate, design §9 — the KPI totals above stay payroll-grade).
 *   - **Week** → by day.
 *   - **Month** → by week.
 *
 * The busy-hours `grid` intentionally spans the **full** fetch window (not the
 * selected period): "when are we busy" is a pattern that reads more clearly over
 * more history, and it's a distinct question from the period's P&L.
 * `updateTarget` writes the editable target-%. See `useLaborPnlSummary` for the
 * lighter Dashboard-card variant.
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

  const { employees } = useEmployees(restaurantId);
  const avgHourlyRateCents = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  // The current period's restaurant-tz date window (design §2.2). `endStr` is
  // today for every granularity; `startStr` widens for week/month.
  const periodWindow = useMemo(
    () => currentPeriodWindow(granularity, getTodayInTimezone(tz)),
    [granularity, tz],
  );

  const periodSales = useMemo(
    () => dailySales.filter((p) => dateInWindow(p.bucketStart, periodWindow.startStr, periodWindow.endStr)),
    [dailySales, periodWindow],
  );
  const periodLabor = useMemo(
    () => dailyLabor.filter((d) => dateInWindow(d.date, periodWindow.startStr, periodWindow.endStr)),
    [dailyLabor, periodWindow],
  );

  // Authoritative (payroll-grade) daily series for the selected period — drives
  // the KPI row + verdict for every granularity.
  const periodDaily = useMemo(
    () => buildFinancialSeries(periodSales, periodLabor, 'day', targetPct),
    [periodSales, periodLabor, targetPct],
  );
  const summary = useMemo(() => summarizeLaborPnl(periodDaily, targetPct), [periodDaily, targetPct]);

  // Chart series: intraday for Day, by-day for Week, by-week for Month.
  const series = useMemo(() => {
    if (granularity === 'day') {
      return buildIntradayFinancialSeries(
        sales,
        sessions,
        tz,
        periodWindow.endStr,
        avgHourlyRateCents,
        targetPct,
      );
    }
    if (granularity === 'week') return periodDaily;
    return buildFinancialSeries(periodSales, periodLabor, 'week', targetPct);
  }, [granularity, sales, sessions, tz, periodWindow, avgHourlyRateCents, targetPct, periodDaily, periodSales, periodLabor]);

  // Staffing callouts track the chart series (so Day callouts are hour ranges,
  // Week days, Month weeks) — labels then match `estimateWindowDollars(series, …)`.
  const overWindows = useMemo(() => extractBalanceWindows(series, 'over'), [series]);
  const underWindows = useMemo(() => extractBalanceWindows(series, 'under'), [series]);

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
    /** Estimated (avg-rate) sub-day labor in the Day chart — see design §9.
     * Week/Month series are payroll-grade. Lets the page label the Day chart. */
    seriesIsShapeEstimate: granularity === 'day',
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
