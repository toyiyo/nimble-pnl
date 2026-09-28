import { describe, it, expect } from 'vitest';

import { computeDailyLaborPercent } from '@/lib/dailyLaborPercent';

const WEEK = ['2026-09-28', '2026-09-29', '2026-09-30'];

describe('computeDailyLaborPercent', () => {
  it('divides scheduled labor cost by projected sales for each day', () => {
    const result = computeDailyLaborPercent({
      weekDays: WEEK,
      dailyCosts: [
        { date: '2026-09-28', total_labor_cost: 250 },
        { date: '2026-09-29', total_labor_cost: 300 },
      ],
      projectedSalesByDay: new Map([
        ['2026-09-28', 1000],
        ['2026-09-29', 1000],
        ['2026-09-30', 2000],
      ]),
      targetLaborPct: 28,
    });

    expect(result.get('2026-09-28')).toEqual({
      laborCost: 250,
      projectedSales: 1000,
      percent: 25,
      overTarget: false,
    });
    expect(result.get('2026-09-29')).toEqual({
      laborCost: 300,
      projectedSales: 1000,
      percent: 30,
      overTarget: true,
    });
  });

  it('uses zero labor cost for a day with no cost row', () => {
    const result = computeDailyLaborPercent({
      weekDays: WEEK,
      dailyCosts: [],
      projectedSalesByDay: new Map([['2026-09-30', 2000]]),
      targetLaborPct: 22,
    });

    expect(result.get('2026-09-30')).toEqual({
      laborCost: 0,
      projectedSales: 2000,
      percent: 0,
      overTarget: false,
    });
  });

  it('returns a null percent when the day has no projected sales', () => {
    const result = computeDailyLaborPercent({
      weekDays: WEEK,
      dailyCosts: [{ date: '2026-09-28', total_labor_cost: 120 }],
      projectedSalesByDay: new Map([['2026-09-28', 0]]),
      targetLaborPct: 22,
    });

    expect(result.get('2026-09-28')).toEqual({
      laborCost: 120,
      projectedSales: 0,
      percent: null,
      overTarget: false,
    });
    expect(result.get('2026-09-29')?.percent).toBeNull();
  });

  it('returns one entry per week day and ignores cost rows outside the week', () => {
    const result = computeDailyLaborPercent({
      weekDays: WEEK,
      dailyCosts: [{ date: '2026-10-05', total_labor_cost: 999 }],
      projectedSalesByDay: new Map(),
      targetLaborPct: 22,
    });

    expect([...result.keys()]).toEqual(WEEK);
  });

  it('does not flag a percent that equals the target', () => {
    const result = computeDailyLaborPercent({
      weekDays: ['2026-09-28'],
      dailyCosts: [{ date: '2026-09-28', total_labor_cost: 220 }],
      projectedSalesByDay: new Map([['2026-09-28', 1000]]),
      targetLaborPct: 22,
    });

    expect(result.get('2026-09-28')?.overTarget).toBe(false);
  });
});
