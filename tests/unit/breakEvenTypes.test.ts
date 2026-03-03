import { describe, it, expect } from 'vitest';
import type { BreakEvenData } from '@/types/operatingCosts';

describe('BreakEvenData type', () => {
  it('includes contribution margin fields', () => {
    const data: BreakEvenData = {
      dailyBreakEven: 854,
      monthlyBreakEven: 25641,
      yearlyBreakEven: 307692,
      totalVariablePercent: 0.61,
      contributionMargin: 0.39,
      todaySales: 1000,
      todayStatus: 'above',
      todayDelta: 146,
      fixedCosts: { items: [], totalDaily: 333, totalMonthly: 10000, totalYearly: 121667 },
      variableCosts: { items: [], totalDaily: 0, avgDailySales: 0 },
      history: [],
      daysAbove: 0,
      daysBelow: 0,
      avgSurplus: 0,
      avgShortfall: 0,
    };
    expect(data.contributionMargin).toBe(0.39);
    expect(data.monthlyBreakEven).toBe(25641);
    expect(data.yearlyBreakEven).toBe(307692);
    expect(data.totalVariablePercent).toBe(0.61);
    expect(data.fixedCosts.totalMonthly).toBe(10000);
    expect(data.fixedCosts.totalYearly).toBe(121667);
  });
});
