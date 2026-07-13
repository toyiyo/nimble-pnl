import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useEmployees } from '@/hooks/useEmployees';
import { computeAvgHourlyRateCents } from '@/lib/staffingCalculator';
import { normalizePunches, identifyWorkSessions } from '@/utils/timePunchProcessing';
import { validateTimeZone, buildSplhGrid, buildSplhTimeseries, summarizeSplh } from '@/lib/splhAnalytics';
import { useSplhData } from '@/hooks/useSplhData';

const WEEKS = 4; // dashboard summary + ~30-day sparkline

/**
 * Lightweight SPLH summary for the Dashboard card: headline actual-vs-target
 * SPLH, verdict, labor %, and a daily sparkline. Skips the heatmap grid's
 * weekly timeline (see `useSplhAnalytics` for the full Scheduling dataset).
 */
export function useSplhSummary(restaurantId: string | null) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = validateTimeZone(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings } = useStaffingSettings(restaurantId);
  const { employees } = useEmployees(restaurantId);
  const target = effectiveSettings.target_splh;
  const avgRate = useMemo(() => computeAvgHourlyRateCents(employees), [employees]);

  const { data, isLoading, isError } = useSplhData(restaurantId, tz, WEEKS);
  const sessions = useMemo(
    () => (data?.punches?.length ? identifyWorkSessions(normalizePunches(data.punches)) : []),
    [data?.punches],
  );
  const grid = useMemo(() => data ? buildSplhGrid(data.sales, sessions, tz, target) : [], [data, sessions, tz, target]);
  const summary = useMemo(() => summarizeSplh(grid, target, avgRate), [grid, target, avgRate]);
  const sparkline = useMemo(() => data ? buildSplhTimeseries(data.sales, sessions, tz, 'day') : [], [data, sessions, tz]);

  return { summary, sparkline, target, isLoading, isError, hasData: (data?.sales?.length ?? 0) > 0 };
}
