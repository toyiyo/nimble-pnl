import { describe, it, expect } from 'vitest';
import {
  calculateRecommendedStaff,
  checkLaborGuardrail,
  consolidateIntoShiftBlocks,
  buildHourlyRecommendations,
} from '@/lib/staffingCalculator';

describe('calculateRecommendedStaff', () => {
  it('divides projected sales by target SPLH and rounds up', () => {
    expect(calculateRecommendedStaff(200, 60, 1)).toBe(4); // 200/60=3.33 → 4
  });

  it('returns minStaff when sales are low', () => {
    expect(calculateRecommendedStaff(10, 60, 2)).toBe(2); // 10/60=0.17 → 1, but min=2
  });

  it('handles zero sales by returning minStaff', () => {
    expect(calculateRecommendedStaff(0, 60, 1)).toBe(1);
  });

  it('handles exact division', () => {
    expect(calculateRecommendedStaff(120, 60, 1)).toBe(2);
  });
});

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
});
