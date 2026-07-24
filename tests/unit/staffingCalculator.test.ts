import { describe, it, expect } from 'vitest';
import {
  checkLaborGuardrail,
  consolidateIntoShiftBlocks,
  buildHourlyRecommendations,
  computeMinStaffFromCrew,
} from '@/lib/staffingCalculator';

describe('checkLaborGuardrail', () => {
  it('returns false when labor pct is under target', () => {
    // 2 staff * $15/hr = $30, $200 sales → 15% < 22%
    expect(checkLaborGuardrail(2, 1500, 200, 22)).toBe(false);
  });

  it('returns true when labor pct exceeds target', () => {
    // 5 staff * $15/hr = $75, $200 sales → 37.5% > 22%
    expect(checkLaborGuardrail(5, 1500, 200, 22)).toBe(true);
  });

  it('returns false when sales are zero (avoid division by zero)', () => {
    expect(checkLaborGuardrail(1, 1500, 0, 22)).toBe(false);
  });
});

describe('consolidateIntoShiftBlocks', () => {
  it('merges contiguous hours with same headcount', () => {
    const recommendations = [
      { hour: 8, recommendedStaff: 2 },
      { hour: 9, recommendedStaff: 2 },
      { hour: 10, recommendedStaff: 2 },
      { hour: 11, recommendedStaff: 3 },
      { hour: 12, recommendedStaff: 3 },
    ];
    const blocks = consolidateIntoShiftBlocks(recommendations, '2026-03-10');
    expect(blocks).toEqual([
      { startHour: 8, endHour: 11, headcount: 2, day: '2026-03-10' },
      { startHour: 11, endHour: 13, headcount: 3, day: '2026-03-10' },
    ]);
  });

  it('returns empty array for empty input', () => {
    expect(consolidateIntoShiftBlocks([], '2026-03-10')).toEqual([]);
  });

  it('splits blocks longer than 8 hours', () => {
    const recommendations = Array.from({ length: 10 }, (_, i) => ({
      hour: 8 + i, // hours 8-17
      recommendedStaff: 2,
    }));
    const blocks = consolidateIntoShiftBlocks(recommendations, '2026-03-10');
    // 10 hours should be split into 8+2
    expect(blocks.length).toBe(2);
    expect(blocks[0]).toEqual({ startHour: 8, endHour: 16, headcount: 2, day: '2026-03-10' });
    expect(blocks[1]).toEqual({ startHour: 16, endHour: 18, headcount: 2, day: '2026-03-10' });
  });

  it('handles single hour', () => {
    const blocks = consolidateIntoShiftBlocks(
      [{ hour: 12, recommendedStaff: 3 }],
      '2026-03-10',
    );
    expect(blocks).toEqual([
      { startHour: 12, endHour: 13, headcount: 3, day: '2026-03-10' },
    ]);
  });
});

describe('computeMinStaffFromCrew', () => {
  it('returns fallback when min_crew is null', () => {
    expect(computeMinStaffFromCrew(null, 2)).toBe(2);
  });

  it('returns fallback when min_crew is empty', () => {
    expect(computeMinStaffFromCrew({}, 2)).toBe(2);
  });

  it('sums position minimums', () => {
    expect(computeMinStaffFromCrew({ Cook: 2, Server: 1, Bartender: 1, Dishwasher: 1 }, 1)).toBe(5);
  });

  it('returns fallback when all values are zero', () => {
    expect(computeMinStaffFromCrew({ Cook: 0, Server: 0 }, 2)).toBe(2);
  });

  it('handles single position', () => {
    expect(computeMinStaffFromCrew({ Cook: 3 }, 1)).toBe(3);
  });
});

describe('buildHourlyRecommendations', () => {
  it('produces recommendation for each hour with sales', () => {
    const hourlySales = [
      { hour: 11, avgSales: 200, sampleCount: 4 },
      { hour: 12, avgSales: 300, sampleCount: 4 },
    ];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result).toHaveLength(2);
    expect(result[0].hour).toBe(11);
    expect(result[0].recommendedStaff).toBe(4); // 200/60=3.33→4
    expect(result[0].projectedSales).toBe(200);
    expect(result[1].recommendedStaff).toBe(5); // 300/60=5
  });

  it('flags hours over labor target', () => {
    const hourlySales = [
      { hour: 8, avgSales: 30, sampleCount: 4 }, // low sales, min staff will push labor % high
    ];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    // 1 staff * $15 = $15, $30 sales → 50% > 22%
    expect(result[0].overTarget).toBe(true);
  });

  it('emits raw pre-floor demand alongside recommendedStaff', () => {
    const hourlySales = [
      { hour: 11, avgSales: 200, sampleCount: 4 }, // 200/60=3.33→4, minStaff=1 → demand=recommendedStaff
    ];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result[0].demand).toBe(4);
    expect(result[0].recommendedStaff).toBe(4);
  });

  it('sets recommendedStaff to max(demand, minStaff) when the floor exceeds demand', () => {
    const hourlySales = [
      { hour: 8, avgSales: 10, sampleCount: 4 }, // 10/60=0.17→1 demand, but minStaff=3
    ];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 3,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result[0].demand).toBe(1);
    expect(result[0].recommendedStaff).toBe(3);
  });

  it('CRITICAL: sets demand to 0 when sales are zero, but recommendedStaff still floors to minStaff', () => {
    const hourlySales = [{ hour: 6, avgSales: 0, sampleCount: 0 }];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 2,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result[0].demand).toBe(0);
    expect(result[0].recommendedStaff).toBe(2);
  });

  it('CRITICAL: sets demand to 0 when sales are negative, but recommendedStaff still floors to minStaff', () => {
    // Negative avgSales shouldn't happen in practice, but a bad refund/void
    // adjustment upstream could produce one — demand must floor to 0 (not a
    // negative headcount), same as the zero-sales case above.
    const hourlySales = [{ hour: 6, avgSales: -50, sampleCount: 4 }];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 60,
      minStaff: 2,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result[0].demand).toBe(0);
    expect(result[0].recommendedStaff).toBe(2);
  });

  it('CRITICAL: sets demand to 0 when targetSplh is zero', () => {
    const hourlySales = [{ hour: 12, avgSales: 200, sampleCount: 4 }];
    const result = buildHourlyRecommendations(hourlySales, {
      targetSplh: 0,
      minStaff: 1,
      avgHourlyRateCents: 1500,
      targetLaborPct: 22,
    });
    expect(result[0].demand).toBe(0);
    expect(result[0].recommendedStaff).toBe(1);
  });
});
