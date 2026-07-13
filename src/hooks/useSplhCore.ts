import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, summarizeSplh } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

/**
 * Shared setup for the SPLH hooks: restaurant tz/target/avg-rate, the
 * paginated sales+punches fetch, work-session derivation, the 7x24 grid, and
 * the headline summary. `useSplhAnalytics` (Scheduling planner) and
 * `useSplhSummary` (Dashboard card) both build on this and only differ in
 * the `weeks` fetch window and which additional timeseries granularities
 * they layer on top (day/week timeline vs. a daily-only sparkline).
 */
export function useSplhCore(restaurantId: string | null, weeks: number) {
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
    () => (data ? buildSplhGrid(data.sales, sessions, tz, target) : []),
    [data, sessions, tz, target],
  );
  const summary = useMemo(() => summarizeSplh(grid, target, avgRate), [grid, target, avgRate]);

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
