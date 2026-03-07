import { useMemo } from 'react';

import { useHourlySalesPattern } from './useHourlySalesPattern';
import { useStaffingSettings } from './useStaffingSettings';
import { useEmployees } from './useEmployees';
import {
  buildHourlyRecommendations,
  consolidateIntoShiftBlocks,
  computeAvgHourlyRateCents,
} from '@/lib/staffingCalculator';

import type {
  HourlySalesData,
  HourlyStaffingRecommendation,
  ShiftBlock,
} from '@/types/scheduling';

export interface StaffingSuggestionsResult {
  recommendations: HourlyStaffingRecommendation[];
  shiftBlocks: ShiftBlock[];
  totalRecommendedHours: number;
  peakStaff: number;
  totalProjectedSales: number;
  totalEstimatedLaborCost: number;
  overallLaborPct: number;
}

/**
 * Pure function: compute staffing suggestions from hourly sales data and params.
 * Exported for testing.
 */
export function computeStaffingSuggestions(
  hourlySales: HourlySalesData[],
  params: {
    targetSplh: number;
    minStaff: number;
    targetLaborPct: number;
    avgHourlyRateCents: number;
    day: string;
  },
): StaffingSuggestionsResult {
  if (hourlySales.length === 0) {
    return {
      recommendations: [],
      shiftBlocks: [],
      totalRecommendedHours: 0,
      peakStaff: 0,
      totalProjectedSales: 0,
      totalEstimatedLaborCost: 0,
      overallLaborPct: 0,
    };
  }

  const recommendations = buildHourlyRecommendations(hourlySales, params);
  const shiftBlocks = consolidateIntoShiftBlocks(recommendations, params.day);

  const totalRecommendedHours = recommendations.reduce(
    (sum, r) => sum + r.recommendedStaff,
    0,
  );
  const peakStaff = Math.max(...recommendations.map((r) => r.recommendedStaff));
  const totalProjectedSales = recommendations.reduce((sum, r) => sum + r.projectedSales, 0);
  const totalEstimatedLaborCost = recommendations.reduce(
    (sum, r) => sum + r.estimatedLaborCost,
    0,
  );
  const overallLaborPct =
    totalProjectedSales > 0 ? (totalEstimatedLaborCost / totalProjectedSales) * 100 : 0;

  return {
    recommendations,
    shiftBlocks,
    totalRecommendedHours,
    peakStaff,
    totalProjectedSales,
    totalEstimatedLaborCost,
    overallLaborPct,
  };
}

/**
 * Hook: fetches hourly sales pattern + staffing settings, computes suggestions for a given day.
 */
export function useStaffingSuggestions(restaurantId: string | null, day: string) {
  const dayOfWeek = new Date(day + 'T12:00:00').getDay();
  const { effectiveSettings, isLoading: settingsLoading } = useStaffingSettings(restaurantId);
  const { data: hourlySales, isLoading: salesLoading } = useHourlySalesPattern(
    restaurantId,
    dayOfWeek,
    effectiveSettings.lookback_weeks,
  );
  const { employees } = useEmployees(restaurantId);

  const avgHourlyRateCents = useMemo(
    () => computeAvgHourlyRateCents(employees),
    [employees],
  );

  const suggestions = useMemo(
    () =>
      computeStaffingSuggestions(hourlySales ?? [], {
        targetSplh: effectiveSettings.target_splh,
        minStaff: effectiveSettings.min_staff,
        targetLaborPct: effectiveSettings.target_labor_pct,
        avgHourlyRateCents,
        day,
      }),
    [hourlySales, effectiveSettings, avgHourlyRateCents, day],
  );

  return {
    ...suggestions,
    isLoading: settingsLoading || salesLoading,
    hasSalesData: (hourlySales?.length ?? 0) > 0,
    effectiveSettings,
  };
}
