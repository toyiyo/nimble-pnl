import { useMemo } from 'react';

import { useQuery } from '@tanstack/react-query';

import { useRestaurantClock } from '@/hooks/useRestaurantClock';
import { useStaffingSettings } from '@/hooks/useStaffingSettings';
import { lookbackSalesQueryOptions } from '@/hooks/useWeekStaffingSuggestions';

import type { DailyLaborPercentInput, DailyLaborPercentView } from '@/lib/dailyLaborPercent';

import { computeDailyLaborPercent, projectDailySales } from '@/lib/dailyLaborPercent';

interface UseDailyLaborPercentOptions {
  /** `dailyCosts` from `useScheduledLaborCosts` for the same week. */
  dailyCosts: DailyLaborPercentInput['dailyCosts'];
  /** True while the shifts or the employees for `dailyCosts` load. */
  costsLoading: boolean;
  /** False skips the sales query (for example, the viewer cannot see wages or sales). */
  enabled: boolean;
}

/**
 * Daily labor cost % for a week of the schedule.
 *
 * Projected sales use the saved lookback-weeks setting and the daily totals
 * from `lookbackSalesQueryOptions` (the `get_hourly_sales_pattern` RPC, by
 * date). This hook does not run the planner's staffing pipeline or its time
 * punch query.
 *
 * @param weekDays - Days of the week as `yyyy-MM-dd`.
 */
export function useDailyLaborPercent(
  restaurantId: string | null,
  weekDays: string[],
  { dailyCosts, costsLoading, enabled }: UseDailyLaborPercentOptions,
): DailyLaborPercentView {
  const { tz, today } = useRestaurantClock();
  const { effectiveSettings, isLoading: settingsLoading } = useStaffingSettings(restaurantId);
  const { target_labor_pct: targetLaborPct, lookback_weeks: lookbackWeeks } = effectiveSettings;

  const salesQuery = lookbackSalesQueryOptions(restaurantId, lookbackWeeks, tz);
  const { data: sales, isLoading: salesLoading, isError } = useQuery({
    ...salesQuery,
    // Wait for the saved lookback, so the default does not start a wasted fetch.
    enabled: salesQuery.enabled && enabled && !settingsLoading,
  });

  const byDay = useMemo(() => {
    const projectedSalesByDay = projectDailySales(sales ?? [], weekDays, { excludeDate: today });
    return computeDailyLaborPercent({ weekDays, dailyCosts, projectedSalesByDay, targetLaborPct });
  }, [sales, weekDays, today, dailyCosts, targetLaborPct]);

  const isLoading = settingsLoading || salesLoading || costsLoading;
  // A failed background refetch keeps the last good rows: keep showing them.
  const hasError = isError && !sales;

  return useMemo(
    () => ({ byDay, isLoading, hasError, targetLaborPct, lookbackWeeks }),
    [byDay, isLoading, hasError, targetLaborPct, lookbackWeeks],
  );
}
