import { useMemo } from 'react';

import { useWeekStaffingSuggestions } from '@/hooks/useWeekStaffingSuggestions';

import { computeDailyLaborPercent, type DailyLaborPercentInput } from '@/lib/dailyLaborPercent';

/**
 * Daily labor cost % for a week of the schedule.
 *
 * Projected sales come from `useWeekStaffingSuggestions` with no overrides, so
 * the percent uses the saved lookback-weeks setting. The planner uses the same
 * source for its hourly labor %. React Query shares the sales query between
 * the callers.
 *
 * @param weekDays - Days of the week as `yyyy-MM-dd`.
 * @param dailyCosts - `dailyCosts` from `useScheduledLaborCosts` for the same week.
 */
export function useDailyLaborPercent(
  restaurantId: string | null,
  weekDays: string[],
  dailyCosts: DailyLaborPercentInput['dailyCosts'],
) {
  const { daySuggestions, activeSettings, isLoading, hasSalesData } = useWeekStaffingSuggestions(
    restaurantId,
    weekDays,
    null,
  );

  const targetLaborPct = activeSettings.target_labor_pct;

  const byDay = useMemo(() => {
    const projectedSalesByDay = new Map<string, number>();
    for (const [day, suggestion] of daySuggestions) {
      projectedSalesByDay.set(day, suggestion.totalProjectedSales);
    }
    return computeDailyLaborPercent({ weekDays, dailyCosts, projectedSalesByDay, targetLaborPct });
  }, [daySuggestions, weekDays, dailyCosts, targetLaborPct]);

  return {
    byDay,
    isLoading,
    hasSalesData,
    targetLaborPct,
    lookbackWeeks: activeSettings.lookback_weeks,
  };
}

export type DailyLaborPercentState = ReturnType<typeof useDailyLaborPercent>;
