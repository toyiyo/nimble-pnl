import { useMemo } from 'react';

import { buildFinancialSeries, summarizeLaborPnl } from '@/lib/laborPnlAnalytics';
import { useLaborPnlCore } from '@/hooks/useLaborPnlCore';

const WEEKS = 4; // dashboard summary + ~30-day sparkline, mirroring useSplhSummary's WEEKS

/**
 * Lightweight labor-P&L summary for the Dashboard card (design §2.1, §5):
 * period totals (labor % of sales, rev/labor-hr, verdict) plus a daily
 * sparkline. No hourly grid is built — that's `useLaborPnlAnalytics` (the
 * `/labor` page, C3). Builds on the shared `useLaborPnlCore` (tz/target/
 * sales+labor plumbing) the same way `useSplhSummary` builds on
 * `useSplhCore`.
 *
 * The sparkline **is** the day-granularity `FinancialPoint[]` series, and
 * `summary` is `summarizeLaborPnl` run over that same series — so the KPI
 * totals are always exactly the sum of the sparkline's buckets (design §8
 * reconciliation invariant), never a second independently-computed total.
 */
export function useLaborPnlSummary(restaurantId: string | null) {
  const { dailySales, dailyLabor, targetPct, capped, hasData, isLoading, isError, error, refetch } =
    useLaborPnlCore(restaurantId, WEEKS);

  const sparkline = useMemo(
    () => buildFinancialSeries(dailySales, dailyLabor, 'day', targetPct),
    [dailySales, dailyLabor, targetPct],
  );

  const summary = useMemo(() => summarizeLaborPnl(sparkline, targetPct), [sparkline, targetPct]);

  return {
    summary,
    sparkline,
    targetPct,
    capped,
    hasData,
    isLoading,
    isError,
    error,
    refetch,
  };
}
