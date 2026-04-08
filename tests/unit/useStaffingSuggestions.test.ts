import { describe, it, expect } from 'vitest';
import { computeStaffingSuggestions } from '@/hooks/useStaffingSuggestions';

describe('computeStaffingSuggestions', () => {
  it('produces shift blocks from hourly sales and settings', () => {
    const hourlySales = [
      { hour: 11, avgSales: 200, sampleCount: 4 },
      { hour: 12, avgSales: 300, sampleCount: 4 },
      { hour: 13, avgSales: 250, sampleCount: 4 },
      { hour: 14, avgSales: 150, sampleCount: 4 },
    ];
    const result = computeStaffingSuggestions(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      targetLaborPct: 22,
      avgHourlyRateCents: 1500,
      day: '2026-03-10',
    });

    expect(result.recommendations).toHaveLength(4);
    expect(result.shiftBlocks.length).toBeGreaterThan(0);
    expect(result.totalRecommendedHours).toBeGreaterThan(0);
    expect(result.peakStaff).toBe(5); // 300/60=5
    expect(result.totalProjectedSales).toBe(900); // 200+300+250+150
  });

  it('returns empty results for no sales data', () => {
    const result = computeStaffingSuggestions([], {
      targetSplh: 60,
      minStaff: 1,
      targetLaborPct: 22,
      avgHourlyRateCents: 1500,
      day: '2026-03-10',
    });
    expect(result.recommendations).toEqual([]);
    expect(result.shiftBlocks).toEqual([]);
    expect(result.peakStaff).toBe(0);
    expect(result.totalProjectedSales).toBe(0);
  });

  it('calculates overall labor percentage', () => {
    const hourlySales = [
      { hour: 12, avgSales: 300, sampleCount: 4 },
    ];
    const result = computeStaffingSuggestions(hourlySales, {
      targetSplh: 60,
      minStaff: 1,
      targetLaborPct: 22,
      avgHourlyRateCents: 1500,
      day: '2026-03-10',
    });
    // 5 staff * $15 = $75, $300 sales → 25%
    expect(result.overallLaborPct).toBeCloseTo(25, 0);
  });
});
