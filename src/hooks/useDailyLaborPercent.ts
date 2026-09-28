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
 * Projected sales use the saved lookback-weeks setting and the same sales
 * query as the planner (`lookbackSalesQueryOptions`), so React Query shares
 * one cache entry. This hook does not run the planner's staffing pipeline or
 * its time punch query.
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
    enabled: salesQuery.enabled && enabled,
  });

  const byDay = useMemo(() => {
    const projectedSalesByDay = projectDailySales(sales ?? [], weekDays, today);
    return computeDailyLaborPercent({ weekDays, dailyCosts, projectedSalesByDay, targetLaborPct });
  }, [sales, weekDays, today, dailyCosts, targetLaborPct]);

  const isLoading = settingsLoading || salesLoading || costsLoading;

  return useMemo(
    () => ({ byDay, isLoading, hasError: isError, targetLaborPct, lookbackWeeks }),
    [byDay, isLoading, isError, targetLaborPct, lookbackWeeks],
  );
}
