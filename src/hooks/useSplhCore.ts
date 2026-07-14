import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, summarizeSplh, summarizeSplhTotals } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

export interface UseSplhCoreOptions {
  /**
   * Build the full 7x24 heatmap grid. Defaults to `true`. Callers that only
   * need the headline summary (e.g. `useSplhSummary` for the Dashboard card)
   * should pass `false` — the grid (and the `Intl.DateTimeFormat`-heavy
   * per-hour bucketing it requires) is never built in that case; the summary
   * is instead computed directly from totals (design §4: "the grid and the
   * weekly bucket are never built for the card").
   */
  buildGrid?: boolean;
}

/**
 * Shared setup for the SPLH hooks: restaurant tz/target/avg-rate, the
 * paginated sales+punches fetch, work-session derivation, the 7x24 grid, and
 * the headline summary. `useSplhAnalytics` (Scheduling planner) and
 * `useSplhSummary` (Dashboard card) both build on this and only differ in
 * the `weeks` fetch window and which additional timeseries granularities
 * they layer on top (day/week timeline vs. a daily-only sparkline).
 */
export function useSplhCore(restaurantId: string | null, weeks: number, options?: UseSplhCoreOptions) {
  const buildGrid = options?.buildGrid ?? true;
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);
  const target = effectiveSettings.target_splh;
  const avgRate = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError, error, refetch } = useSplhData(restaurantId, tz, weeks);

  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );
  const grid = useMemo(
    () => (data && buildGrid ? buildSplhGrid(data.sales, sessions, tz, target) : []),
    [data, buildGrid, sessions, tz, target],
  );
  const summary = useMemo(
    () => (buildGrid
      ? summarizeSplh(grid, target, avgRate)
      : summarizeSplhTotals(data?.sales ?? [], sessions, target, avgRate)),
    [buildGrid, grid, data?.sales, sessions, target, avgRate],
  );

  return {
    data,
    tz,
    target,
    sessions,
    grid,
    summary,
    hasData: (data?.sales?.length ?? 0) > 0,
    isLoading,
    isError,
    error,
    refetch,
  };
}
