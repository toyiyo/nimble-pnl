import {
  buildHourlyRecommendations,
  consolidateIntoShiftBlocks,
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
