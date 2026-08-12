import { useMemo } from 'react';

import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { useLaborSalesAnalytics } from '@/hooks/useLaborSalesAnalytics';
import { useLaborCostsFromTimeTracking } from '@/hooks/useLaborCostsFromTimeTracking';
import { dailySalesFromRpc } from '@/lib/laborPnlAnalytics';
import { safeTz } from '@/lib/restaurantClock';
import { useTodayInTimezone } from '@/hooks/useTodayInTimezone';

/**
 * The labor-cost fetch window, derived from the restaurant-local "today"
 * (`todayStr`), not host/UTC `new Date()`. `windowEnd` is anchored at
 * end-of-day (23:59:59.999) so today's evening punches are not cut off:
 * `useLaborCostsFromTimeTracking` feeds `windowEnd` into
 * `lookaheadPunchFetchRange`, which widens only the END of the punch fetch. A
 * midnight-start anchor would drop every punch after 00:00 today, undercounting
 * today's labor against sales (which have no such cutoff).
 */
function laborCostWindow(tz: string, weeks: number, todayStr: string): { windowStart: Date; windowEnd: Date } {
  const [y, m, d] = todayStr.split('-').map(Number);
  const windowEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
  const windowStart = new Date(y, m - 1, d - weeks * 7);
  return { windowStart, windowEnd };
}

/**
 * Shared data core for the Labor P&L feature (dashboard card + `/labor` page).
 * Fetches the SQL sales aggregate (`useLaborSalesAnalytics`) and the
 * payroll-grade daily labor costs (`useLaborCostsFromTimeTracking`), then joins
 * them by restaurant-local date. The sales aggregate replaces the old
 * client-side aggregation of ~23,700 raw rows. Punch → session math stays in
 * the labor-cost hook. `tz` is validated here via `safeTz`.
 */
export function useLaborPnlCore(restaurantId: string | null, weeks: number) {
  const { selectedRestaurant } = useRestaurantContext();
  const tz = safeTz(selectedRestaurant?.restaurant?.timezone);
  const { effectiveSettings, updateSettings, isSaving: isSavingTarget } = useStaffingSettings(restaurantId);
  const targetPct = effectiveSettings.target_labor_pct;

  const todayStr = useTodayInTimezone(tz);
  const { windowStart, windowEnd } = useMemo(
    () => laborCostWindow(tz, weeks, todayStr),
    [tz, weeks, todayStr],
  );

  const {
    data,
    isLoading: salesLoading,
    isError: salesIsError,
    error: salesError,
    refetch: refetchSales,
  } = useLaborSalesAnalytics(restaurantId, tz, weeks);

  const {
    dailyCosts,
    isLoading: laborLoading,
    error: laborError,
    refetch: refetchLabor,
    capped: laborCapped,
  } = useLaborCostsFromTimeTracking(restaurantId, windowStart, windowEnd, { throughNow: true });

  const dailySales = useMemo(() => (data ? dailySalesFromRpc(data.daily) : []), [data]);

  return {
    tz,
    targetPct,
    todayStr,
    windowStart,
    windowEnd,
    dailySales,
    dailyLabor: dailyCosts,
    grid: data?.grid ?? [],
    byWeekday: data?.by_weekday ?? [],
    hasHourly: data?.has_hourly ?? false,
    // The SQL aggregate never truncates; `capped` reflects only the labor fetch.
    capped: laborCapped,
    // Sales present + zero labor days = time-tracking-not-set-up invite state,
    // not a silent all-zero labor read (design §6).
    hasData: dailySales.some((p) => p.totalSales !== 0) && dailyCosts.length > 0,
    isLoading: salesLoading || laborLoading,
    isError: salesIsError || !!laborError,
    error: salesError ?? laborError ?? null,
    refetch: () => {
      refetchSales();
      refetchLabor();
    },
    updateSettings,
    isSavingTarget,
  };
}
