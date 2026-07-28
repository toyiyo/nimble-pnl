import { describe, it, expect } from 'vitest';
import {
  checkLaborGuardrail,
  consolidateIntoShiftBlocks,
  buildHourlyRecommendations,
  computeMinStaffFromCrew,
  computeAvgHourlyRateCents,
  hasHourlyWageData,
  impliedLabor,
  laborConsistentSplh,
} from '@/lib/staffingCalculator';
import type { Employee } from '@/types/scheduling';

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

  it('should emit raw pre-floor demand alongside recommendedStaff when minStaff does not exceed demand', () => {
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

  it('should set recommendedStaff to max(demand, minStaff) when the floor exceeds demand', () => {
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

  it('should set demand to 0 when sales are zero, while recommendedStaff still floors to minStaff', () => {
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

  it('should set demand to 0 when sales are negative, while recommendedStaff still floors to minStaff', () => {
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

  it('should set demand to 0 when targetSplh is zero', () => {
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

function emp(overrides: Partial<Employee> = {}): Employee {
  return {
    compensation_type: 'hourly',
    is_active: true,
    hourly_rate: 1000,
    ...overrides,
  } as Employee;
}

describe('hasHourlyWageData', () => {
  it('should be false when the roster is undefined or empty', () => {
    expect(hasHourlyWageData(undefined)).toBe(false);
    expect(hasHourlyWageData([])).toBe(false);
  });

  it('should be false when every employee is salaried', () => {
    expect(hasHourlyWageData([emp({ compensation_type: 'salary' })])).toBe(false);
  });

  it('should be false when the only hourly employee is inactive', () => {
    expect(hasHourlyWageData([emp({ is_active: false })])).toBe(false);
  });

  it('should be true when at least one active hourly employee exists', () => {
    expect(hasHourlyWageData([emp({ compensation_type: 'salary' }), emp()])).toBe(true);
  });

  it('should agree with computeAvgHourlyRateCents about when the wage is real', () => {
    // Salaried-only → predicate false AND the wage is the $15 default, not derived.
    const salaried = [emp({ compensation_type: 'salary', hourly_rate: 9999 })];
    expect(hasHourlyWageData(salaried)).toBe(false);
    expect(computeAvgHourlyRateCents(salaried)).toBe(1500);
  });
});

describe('impliedLabor', () => {
  it('CRITICAL: pct = wage / splh * 100', () => {
    const { pct } = impliedLabor({ wage: 20, splh: 25, targetLaborPct: 75 });
    expect(pct).toBe(80);
  });

  it('CRITICAL: overTarget is true once pct exceeds targetLaborPct + 0.05', () => {
    // wage/splh*100 = 75; targetLaborPct=74.94 -> threshold 74.99 -> 75 > 74.99
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.94 });
    expect(pct).toBe(75);
    expect(overTarget).toBe(true);
  });

  it('CRITICAL: overTarget is false when pct is at or below target', () => {
    // wage/splh*100 = 30; targetLaborPct=30 (well above threshold 30.05)
    const { pct, overTarget } = impliedLabor({ wage: 30, splh: 100, targetLaborPct: 30 });
    expect(pct).toBe(30);
    expect(overTarget).toBe(false);
  });

  it('BOUNDARY: pct exactly equal to targetLaborPct + 0.05 → not overTarget (strict >)', () => {
    // wage/splh*100 = 75; targetLaborPct=74.95 -> threshold 75.0 exactly -> 75 > 75 is false
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.95 });
    expect(pct).toBe(75);
    expect(overTarget).toBe(false);
  });

  it('BOUNDARY: pct just 0.01 over threshold → overTarget true', () => {
    // wage/splh*100 = 75; targetLaborPct=74.94 -> threshold 74.99 -> 75 > 74.99 -> true
    const { overTarget } = impliedLabor({ wage: 15, splh: 20, targetLaborPct: 74.94 });
    expect(overTarget).toBe(true);
  });

  it('BOUNDARY: splh === 0 degrades to pct 0 instead of Infinity', () => {
    const { pct, overTarget } = impliedLabor({ wage: 15, splh: 0, targetLaborPct: 22 });
    expect(pct).toBe(0);
    expect(overTarget).toBe(false);
  });
});

describe('laborConsistentSplh', () => {
  it('CRITICAL: consistent = wage / (targetLaborPct / 100)', () => {
    expect(laborConsistentSplh({ wage: 20, targetLaborPct: 25 })).toBe(80);
  });

  it('CRITICAL: a lower targetLaborPct yields a higher consistent SPLH (inverse relationship)', () => {
    const lower = laborConsistentSplh({ wage: 20, targetLaborPct: 20 });
    const higher = laborConsistentSplh({ wage: 20, targetLaborPct: 40 });
    expect(lower).toBeGreaterThan(higher);
  });

  it('BOUNDARY: targetLaborPct === 100 → consistent === wage', () => {
    expect(laborConsistentSplh({ wage: 30, targetLaborPct: 100 })).toBe(30);
  });

  it('BOUNDARY: targetLaborPct === 0 degrades to 0 instead of Infinity', () => {
    expect(laborConsistentSplh({ wage: 30, targetLaborPct: 0 })).toBe(0);
  });
});

describe('SPLH ↔ labor % identity (real-world case)', () => {
  it('should flag $30 SPLH at $10/hr against a 25% target and name $40 as consistent', () => {
    const { pct, overTarget } = impliedLabor({ wage: 10, splh: 30, targetLaborPct: 25 });
    expect(pct).toBeCloseTo(33.33, 1);
    expect(overTarget).toBe(true);
    expect(laborConsistentSplh({ wage: 10, targetLaborPct: 25 })).toBe(40);
  });

  it('should not flag the labor-consistent SPLH when fed back through', () => {
    for (const [wage, target] of [[10, 25], [10.37, 30], [18.75, 18], [22, 33]] as const) {
      const consistent = laborConsistentSplh({ wage, targetLaborPct: target });
      const { pct, overTarget } = impliedLabor({ wage, splh: consistent, targetLaborPct: target });
      expect(pct).toBeCloseTo(target, 6);
      expect(overTarget).toBe(false);
    }
  });
});
