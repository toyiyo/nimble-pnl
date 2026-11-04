import { describe, it, expect } from 'vitest';

import {
  computeDailyLaborPercent,
  describeDailyLaborPercent,
  formatDailyLaborPercent,
  projectDailySales,
} from '@/lib/dailyLaborPercent';

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

describe('computeDailyLaborPercent rounding', () => {
  it('compares the whole-number percent with the target', () => {
    const result = computeDailyLaborPercent({
      weekDays: ['2026-09-28', '2026-09-29'],
      dailyCosts: [
        { date: '2026-09-28', total_labor_cost: 223 },
        { date: '2026-09-29', total_labor_cost: 226 },
      ],
      projectedSalesByDay: new Map([
        ['2026-09-28', 1000],
        ['2026-09-29', 1000],
      ]),
      targetLaborPct: 22,
    });

    // 22.3% shows as "22%": not over a 22% target.
    expect(result.get('2026-09-28')?.overTarget).toBe(false);
    // 22.6% shows as "23%": over a 22% target.
    expect(result.get('2026-09-29')?.overTarget).toBe(true);
  });
});

describe('projectDailySales', () => {
  // 2026-09-14, 2026-09-21 and 2026-09-28 are Mondays. 2026-09-15 is a Tuesday.
  it('averages the daily totals of the same weekday', () => {
    const sales = projectDailySales(
      [
        { sale_date: '2026-09-14', total_price: 600 },
        { sale_date: '2026-09-14', total_price: 400 },
        { sale_date: '2026-09-21', total_price: 2000 },
        { sale_date: '2026-09-15', total_price: 500 },
      ],
      ['2026-09-28', '2026-09-29'],
    );

    expect(sales.get('2026-09-28')).toBe(1500);
    expect(sales.get('2026-09-29')).toBe(500);
  });

  it('does not inflate the day with a sale in a sparse hour', () => {
    // One large late sale on one of two Mondays adds half its value, not all of it.
    const sales = projectDailySales(
      [
        { sale_date: '2026-09-14', total_price: 1000 },
        { sale_date: '2026-09-21', total_price: 1000 },
        { sale_date: '2026-09-21', total_price: 400 },
      ],
      ['2026-09-28'],
    );

    expect(sales.get('2026-09-28')).toBe(1200);
  });

  it('skips the excluded date and parses string amounts', () => {
    const sales = projectDailySales(
      [
        { sale_date: '2026-09-21', total_price: '1000.50' },
        { sale_date: '2026-09-28', total_price: 20 },
      ],
      ['2026-09-28'],
      { excludeDate: '2026-09-28' },
    );

    expect(sales.get('2026-09-28')).toBe(1000.5);
  });

  it('does not count the last date of a truncated result', () => {
    const sales = projectDailySales(
      [
        { sale_date: '2026-09-14', total_price: 1000 },
        // The row cap cut this date off after a few rows.
        { sale_date: '2026-09-21', total_price: 100 },
      ],
      ['2026-09-28'],
      { truncated: true },
    );

    expect(sales.get('2026-09-28')).toBe(1000);
  });

  it('returns zero for a weekday with no sales', () => {
    const sales = projectDailySales([], ['2026-09-28']);
    expect(sales.get('2026-09-28')).toBe(0);
  });

  it('does not count a date whose total is zero or negative', () => {
    const sales = projectDailySales(
      [
        { sale_date: '2026-09-14', total_price: 0 },
        { sale_date: '2026-09-21', total_price: 800 },
        { sale_date: '2026-09-07', total_price: null },
      ],
      ['2026-09-28'],
    );

    expect(sales.get('2026-09-28')).toBe(800);
  });
});

describe('formatDailyLaborPercent', () => {
  it('rounds to a whole number', () => {
    expect(
      formatDailyLaborPercent({ laborCost: 1, projectedSales: 1, percent: 24.4, overTarget: false }),
    ).toBe('Labor 24%');
  });

  it('shows a dash when there is no percent', () => {
    expect(formatDailyLaborPercent(undefined)).toBe('Labor —');
    expect(
      formatDailyLaborPercent({ laborCost: 1, projectedSales: 0, percent: null, overTarget: false }),
    ).toBe('Labor —');
  });

  it('clamps very large values', () => {
    expect(
      formatDailyLaborPercent({ laborCost: 500, projectedSales: 1, percent: 50000, overTarget: true }),
    ).toBe('Labor >999%');
  });
});

describe('describeDailyLaborPercent', () => {
  const VIEW = { hasError: false, targetLaborPct: 22, lookbackWeeks: 4 };

  it('describes the percent, the dollars and the target', () => {
    expect(
      describeDailyLaborPercent(
        { laborCost: 212.4, projectedSales: 1000, percent: 21.24, overTarget: false },
        'Mon, Sep 28',
        VIEW,
      ),
    ).toBe(
      'Mon, Sep 28 labor cost: 21% of projected sales. $212 scheduled, $1,000 projected sales, target 22%.',
    );
  });

  it('says when the day is over the target', () => {
    expect(
      describeDailyLaborPercent(
        { laborCost: 300, projectedSales: 1000, percent: 30, overTarget: true },
        'Mon, Sep 28',
        VIEW,
      ),
    ).toMatch(/over the 22% target/);
  });

  it('says when there is no sales history', () => {
    expect(describeDailyLaborPercent(undefined, 'Mon, Sep 28', VIEW)).toBe(
      'Mon, Sep 28 labor cost: no projected sales. No sales history for this weekday in the last 4 weeks.',
    );
  });

  it('starts with "Labor cost" when the day label is empty', () => {
    expect(
      describeDailyLaborPercent(
        { laborCost: 300, projectedSales: 1000, percent: 30, overTarget: true },
        '',
        VIEW,
      ),
    ).toBe('Labor cost: 30% of projected sales. $300 scheduled, $1,000 projected sales, over the 22% target.');
  });

  it('says when the sales history did not load', () => {
    expect(describeDailyLaborPercent(undefined, 'Mon, Sep 28', { ...VIEW, hasError: true })).toBe(
      'Mon, Sep 28 labor cost: could not load projected sales.',
    );
  });
});
