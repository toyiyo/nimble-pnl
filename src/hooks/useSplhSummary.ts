import { useMemo } from 'react';

import { buildSplhTimeseries } from '@/lib/splhAnalytics';
import { useSplhCore } from '@/hooks/useSplhCore';

const WEEKS = 4; // dashboard summary + ~30-day sparkline

/**
 * Lightweight SPLH summary for the Dashboard card: headline actual-vs-target
 * SPLH, verdict, labor %, and a daily sparkline. Skips the heatmap grid's
 * weekly timeline (see `useSplhAnalytics` for the full Scheduling dataset).
 * Builds on the shared `useSplhCore` (tz/target/grid/summary plumbing).
 */
export function useSplhSummary(restaurantId: string | null) {
  const { data, tz, target, sessions, summary, hasData, isLoading, isError, refetch } =
    useSplhCore(restaurantId, WEEKS);

  const sparkline = useMemo(
    () => (data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : []),
    [data, sessions, tz],
  );

  return {
    summary,
    sparkline,
    target,
    isLoading,
    isError,
    hasData,
    refetch,
  };
}
