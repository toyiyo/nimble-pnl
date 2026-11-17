import { describe, it, expect } from 'vitest';
import {
  computeDailyLaborPercent,
  projectDailySales,
  formatDailyLaborPercent,
  MAX_SHOWN_LABOR_PERCENT,
} from '../../supabase/functions/_shared/labor/dailyLaborPercent';
import { calculateBreakEven } from '../../supabase/functions/_shared/labor/breakEven';
import type { OperatingCost } from '../../supabase/functions/_shared/labor/breakEven';
import { calculateLaborBudget } from '../../supabase/functions/_shared/labor/laborBudget';
import {
  DEFAULT_HOURLY_RATE_CENTS,
  computeAvgHourlyRateCents,
  hasHourlyWageData,
  checkLaborGuardrail,
} from '../../supabase/functions/_shared/labor/staffingGuardrail';

function cost(over: Partial<OperatingCost>): OperatingCost {
  return {
    id: 'c1',
    restaurantId: 'r1',
    costType: 'fixed',
    category: 'rent',
    name: 'Rent',
    entryType: 'value',
    monthlyValue: 0,
    percentageValue: 0,
    isAutoCalculated: false,
    manualOverride: false,
    averagingMonths: 3,
    displayOrder: 0,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

describe('projectDailySales', () => {
  it('excludes today and weekdays with total <= 0', () => {
    // 2026-10-05 and 2026-10-12 are Mondays; 2026-10-06 is Tuesday.
    const rows = [
      { sale_date: '2026-10-05', total_price: 100 },
      { sale_date: '2026-10-12', total_price: 900 },
      { sale_date: '2026-10-06', total_price: 0 },
    ];
    const out = projectDailySales(rows, ['2026-10-12', '2026-10-13'], { excludeDate: '2026-10-12' });
    expect(out.get('2026-10-12')).toBe(100);
    expect(out.get('2026-10-13')).toBe(0);
  });
});

describe('computeDailyLaborPercent', () => {
  it('gives null percent when projected sales are 0', () => {
    const r = computeDailyLaborPercent({
      weekDays: ['2026-10-12'],
      dailyCosts: [{ date: '2026-10-12', total_labor_cost: 50 }],
      projectedSalesByDay: new Map([['2026-10-12', 0]]),
      targetLaborPct: 30,
    });
    expect(r.get('2026-10-12')?.percent).toBeNull();
    expect(formatDailyLaborPercent(r.get('2026-10-12'))).toBe('Labor —');
  });

  it('caps the shown text at >999%', () => {
    expect(MAX_SHOWN_LABOR_PERCENT).toBe(999);
    const r = computeDailyLaborPercent({
      weekDays: ['d'],
      dailyCosts: [{ date: 'd', total_labor_cost: 5000 }],
      projectedSalesByDay: new Map([['d', 100]]),
      targetLaborPct: 30,
    });
    expect(formatDailyLaborPercent(r.get('d'))).toBe('Labor >999%');
  });

  it('sets over-target with Math.round(percent) > target', () => {
    const run = (cost: number) =>
      computeDailyLaborPercent({
        weekDays: ['d'],
        dailyCosts: [{ date: 'd', total_labor_cost: cost }],
        projectedSalesByDay: new Map([['d', 1000]]),
        targetLaborPct: 22,
      }).get('d');
    expect(run(222)?.overTarget).toBe(false); // 22.2 rounds to 22
    expect(run(226)?.overTarget).toBe(true); // 22.6 rounds to 23
  });
});

describe('calculateBreakEven', () => {
  it('fills missing sales dates with 0 in the average', () => {
    const r = calculateBreakEven([], [{ date: '2026-10-11', netRevenue: 1400, transactionCount: 1 }], 0, '2026-10-11', 14);
    expect(r.variableCosts.avgDailySales).toBe(100);
  });
});

describe('calculateLaborBudget', () => {
  const pctLabor = cost({ category: 'labor', entryType: 'percentage', percentageValue: 0.3 });
  const be = (avg: number, daily: number) =>
    ({ variableCosts: { avgDailySales: avg }, dailyBreakEven: daily }) as never;

  it('falls back to break-even when avgDailySales is 0', () => {
    const r = calculateLaborBudget(10, [pctLabor], be(0, 1000));
    expect(r.hasBudget).toBe(true);
    expect(r.source).toBe('breakeven');
  });

  it('has no budget when both are 0', () => {
    expect(calculateLaborBudget(10, [pctLabor], be(0, 0)).hasBudget).toBe(false);
  });

  it('sets the tier at the boundaries', () => {
    // target = 1000 * 0.1 * 7 = 700
    const labor = cost({ category: 'labor', entryType: 'percentage', percentageValue: 0.1 });
    const tier = (pct: number) => calculateLaborBudget((700 * pct) / 100, [labor], be(1000, 0)).tier;
    expect(tier(79.9)).toBe('success');
    expect(tier(80)).toBe('warning');
    expect(tier(100)).toBe('warning');
    expect(tier(100.1)).toBe('danger');
  });
});

describe('staffing guardrail', () => {
  it('uses the default rate and reports no wage data without a paid hourly employee', () => {
    const emps = [{ compensation_type: 'hourly', is_active: true, hourly_rate: 0 }, { compensation_type: 'salary', is_active: true }];
    expect(computeAvgHourlyRateCents(emps)).toBe(DEFAULT_HOURLY_RATE_CENTS);
    expect(DEFAULT_HOURLY_RATE_CENTS).toBe(1500);
    expect(hasHourlyWageData(emps)).toBe(false);
  });

  it('checkLaborGuardrail is strict >', () => {
    // 2 staff * $15 = $30 on $100 sales = 30%
    expect(checkLaborGuardrail(2, 1500, 100, 30)).toBe(false);
    expect(checkLaborGuardrail(2, 1500, 100, 29.9)).toBe(true);
  });
});
