import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, buildSplhTimeseries, summarizeSplh } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

const WEEKS = 12; // covers weekly timeline; grid uses same rows

/**
 * Full SPLH dataset for the Scheduling planner: heatmap grid + day/week
 * timelines + headline summary. See `useSplhSummary` for the lighter
 * dashboard-card variant that skips the grid/weekly timeline.
 */
export function useSplhAnalytics(restaurantId: string | null) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);
  const target = effectiveSettings.target_splh;
  const avgRate = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError, error, refetch } = useSplhData(restaurantId, tz, WEEKS);

  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );
  const grid = useMemo(() => data ? buildSplhGrid(data.sales, sessions, tz, target) : [], [data, sessions, tz, target]);
  const daily = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : [], [data, sessions, tz]);
  const weekly = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'week') : [], [data, sessions, tz]);
  const summary = useMemo(() => summarizeSplh(grid, target, avgRate), [grid, target, avgRate]);
  const hasHourlyBreakdown = useMemo(() => (data?.sales ?? []).some(s => !!s.sold_at), [data?.sales]);

  return {
    grid, daily, weekly, summary, target, tz,
    hasHourlyBreakdown,
    capped: data?.capped ?? false,
    hasData: (data?.sales?.length ?? 0) > 0,
    isLoading, isError, error, refetch,
  };
}
