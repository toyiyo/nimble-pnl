import type { HourlySalesData, HourlyStaffingRecommendation, ShiftBlock } from '@/types/scheduling';

const MAX_SHIFT_HOURS = 8;

export function calculateRecommendedStaff(
  projectedSales: number,
  targetSplh: number,
  minStaff: number,
): number {
  if (projectedSales <= 0 || targetSplh <= 0) return minStaff;
  return Math.max(Math.ceil(projectedSales / targetSplh), minStaff);
}

export function checkLaborGuardrail(
  staffCount: number,
  avgHourlyRateCents: number,
  projectedSales: number,
  targetLaborPct: number,
): boolean {
  if (projectedSales <= 0) return false;
  const laborCost = staffCount * (avgHourlyRateCents / 100);
  const laborPct = (laborCost / projectedSales) * 100;
  return laborPct > targetLaborPct;
}

export function buildHourlyRecommendations(
  hourlySales: HourlySalesData[],
  params: {
    targetSplh: number;
    minStaff: number;
    avgHourlyRateCents: number;
    targetLaborPct: number;
  },
): HourlyStaffingRecommendation[] {
  return hourlySales.map(({ hour, avgSales }) => {
    const recommendedStaff = calculateRecommendedStaff(avgSales, params.targetSplh, params.minStaff);
    const estimatedLaborCost = recommendedStaff * (params.avgHourlyRateCents / 100);
    const laborPct = avgSales > 0 ? (estimatedLaborCost / avgSales) * 100 : 0;
    const overTarget = checkLaborGuardrail(
      recommendedStaff,
      params.avgHourlyRateCents,
      avgSales,
      params.targetLaborPct,
    );
    return {
      hour,
      projectedSales: avgSales,
      recommendedStaff,
      estimatedLaborCost,
      laborPct,
      overTarget,
    };
  });
}

export function consolidateIntoShiftBlocks(
  recommendations: Pick<HourlyStaffingRecommendation, 'hour' | 'recommendedStaff'>[],
  day: string,
): ShiftBlock[] {
  if (recommendations.length === 0) return [];

  const sorted = [...recommendations].sort((a, b) => a.hour - b.hour);
  const rawBlocks: ShiftBlock[] = [];

  let blockStart = sorted[0].hour;
  let blockHeadcount = sorted[0].recommendedStaff;

  for (let i = 1; i <= sorted.length; i++) {
    const current = sorted[i];
    const isEnd = !current;
    const isDifferent = current && current.recommendedStaff !== blockHeadcount;
    const isGap = current && current.hour !== sorted[i - 1].hour + 1;

    if (isEnd || isDifferent || isGap) {
      rawBlocks.push({
        startHour: blockStart,
        endHour: sorted[i - 1].hour + 1,
        headcount: blockHeadcount,
        day,
      });
      if (current) {
        blockStart = current.hour;
        blockHeadcount = current.recommendedStaff;
      }
    }
  }

  // Split any blocks longer than MAX_SHIFT_HOURS
  const result: ShiftBlock[] = [];
  for (const block of rawBlocks) {
    const duration = block.endHour - block.startHour;
    if (duration > MAX_SHIFT_HOURS) {
      result.push({ ...block, endHour: block.startHour + MAX_SHIFT_HOURS });
      result.push({ ...block, startHour: block.startHour + MAX_SHIFT_HOURS });
    } else {
      result.push(block);
    }
  }

  return result;
}
