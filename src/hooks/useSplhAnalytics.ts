import { useMemo } from 'react';

import { buildSplhTimeseries } from '@/lib/splhAnalytics';
import { useSplhCore } from '@/hooks/useSplhCore';

const WEEKS = 12; // covers weekly timeline; grid uses same rows

/**
 * Full SPLH dataset for the Scheduling planner: heatmap grid + day/week
 * timelines + headline summary. See `useSplhSummary` for the lighter
 * dashboard-card variant that skips the grid/weekly timeline. Both build on
 * the shared `useSplhCore` (tz/target/grid/summary plumbing).
 */
export function useSplhAnalytics(restaurantId: string | null) {
  const { data, tz, target, sessions, grid, summary, hasData, isLoading, isError, error, refetch } =
    useSplhCore(restaurantId, WEEKS);

  const daily = useMemo(
    () => (data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : []),
    [data, sessions, tz],
  );
  const weekly = useMemo(
    () => (data ? buildSplhTimeseries(data.sales, sessions, tz, 'week') : []),
    [data, sessions, tz],
  );
  const hasHourlyBreakdown = useMemo(() => (data?.sales ?? []).some(s => !!s.sold_at), [data?.sales]);

  return {
    grid, daily, weekly, summary, target, tz,
    hasHourlyBreakdown,
    capped: data?.capped ?? false,
    hasData,
    isLoading, isError, error, refetch,
  };
}
