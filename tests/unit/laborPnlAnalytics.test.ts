import { describe, it, expect } from 'vitest';
import {
  classifyBalance,
  LABOR_BALANCE_BAND,
  monthKeyOf,
  bucketKeyOf,
  buildFinancialSeries,
  buildSalesVolumeGrid,
} from '@/lib/laborPnlAnalytics';
import type { SplhPoint, SplhGridCell } from '@/lib/splhAnalytics';
import type { LaborCostData } from '@/hooks/useLaborCostsFromTimeTracking';

function sale(bucketStart: string, totalSales: number): SplhPoint {
  return { bucketStart, label: bucketStart, totalSales, totalHours: 0, splh: null };
}

function gridCell(dow: number, hour: number, totalSales: number): SplhGridCell {
  return { dow, hour, totalSales, totalHours: 0, splh: null, state: 'no-labor' };
}

function labor(date: string, total_labor_cost: number, total_hours: number): LaborCostData {
  return {
    date,
    total_labor_cost,
    hourly_wages: total_labor_cost,
    salary_wages: 0,
    contractor_payments: 0,
    total_hours,
  };
}

describe('LABOR_BALANCE_BAND', () => {
  it('defaults to 6 percentage points', () => {
    expect(LABOR_BALANCE_BAND).toBe(6);
  });
});

describe('classifyBalance', () => {
  it('classifies over when labor% exceeds target+band', () => {
    expect(classifyBalance(28.01, 22, 6)).toBe('over');
  });

  it('classifies under when labor% is below target-band', () => {
    expect(classifyBalance(15.99, 22, 6)).toBe('under');
  });

  it('classifies balanced strictly within the band', () => {
    expect(classifyBalance(22, 22, 6)).toBe('balanced');
    expect(classifyBalance(25, 22, 6)).toBe('balanced');
    expect(classifyBalance(19, 22, 6)).toBe('balanced');
  });

  it('treats exactly target+band and target-band as balanced (inclusive edges)', () => {
    expect(classifyBalance(28, 22, 6)).toBe('balanced'); // target + band
    expect(classifyBalance(16, 22, 6)).toBe('balanced'); // target - band
  });

  it('defaults band to LABOR_BALANCE_BAND when omitted', () => {
    expect(classifyBalance(28, 22)).toBe('balanced');
    expect(classifyBalance(28.01, 22)).toBe('over');
  });

  it('guards targetPct<=0 as balanced regardless of laborPct', () => {
    expect(classifyBalance(50, 0)).toBe('balanced');
    expect(classifyBalance(50, -5)).toBe('balanced');
  });

  it('treats a null laborPct (no-sales bucket) as balanced, never over/under', () => {
    expect(classifyBalance(null, 22, 6)).toBe('balanced');
  });
});

describe('monthKeyOf', () => {
  it('returns the calendar-month key YYYY-MM for a mid-month date', () => {
    expect(monthKeyOf('2026-07-20')).toBe('2026-07');
  });

  it('returns the calendar-month key for the first and last day of a month', () => {
    expect(monthKeyOf('2026-07-01')).toBe('2026-07');
    expect(monthKeyOf('2026-07-31')).toBe('2026-07');
  });

  it('handles the Dec→Jan year boundary', () => {
    expect(monthKeyOf('2025-12-31')).toBe('2025-12');
    expect(monthKeyOf('2026-01-01')).toBe('2026-01');
  });
});

describe('bucketKeyOf', () => {
  it('passes the date through unchanged for day granularity', () => {
    expect(bucketKeyOf('2026-07-20', 'day')).toBe('2026-07-20');
  });

  it('buckets to the Monday of the week for week granularity (reusing mondayOf)', () => {
    // 2026-07-20 is a Monday.
    expect(bucketKeyOf('2026-07-20', 'week')).toBe('2026-07-20');
    // 2026-07-24 is a Friday in the same week.
    expect(bucketKeyOf('2026-07-24', 'week')).toBe('2026-07-20');
  });

  it('buckets to the calendar month for month granularity', () => {
    expect(bucketKeyOf('2026-07-24', 'month')).toBe('2026-07');
  });

  it('handles the Dec→Jan boundary consistently across all granularities', () => {
    expect(bucketKeyOf('2025-12-31', 'day')).toBe('2025-12-31');
    expect(bucketKeyOf('2025-12-31', 'month')).toBe('2025-12');
    // 2025-12-31 is a Wednesday; its Monday is 2025-12-29.
    expect(bucketKeyOf('2025-12-31', 'week')).toBe('2025-12-29');
  });
});

describe('buildFinancialSeries', () => {
  it('day granularity: passes each day through as its own bucket', () => {
    const points = buildFinancialSeries(
      [sale('2026-07-20', 1000), sale('2026-07-21', 2000)],
      [labor('2026-07-20', 220, 40), labor('2026-07-21', 440, 80)],
      'day',
      22,
    );
    expect(points).toEqual([
      {
        bucketStart: '2026-07-20',
        label: '2026-07-20',
        sales: 1000,
        laborCost: 220,
        laborHours: 40,
        laborPct: 22,
        balanceState: 'balanced',
      },
      {
        bucketStart: '2026-07-21',
        label: '2026-07-21',
        sales: 2000,
        laborCost: 440,
        laborHours: 80,
        laborPct: 22,
        balanceState: 'balanced',
      },
    ]);
  });

  it('week granularity: aggregates days in the same week into the Monday bucket', () => {
    // 2026-07-20 (Mon) .. 2026-07-24 (Fri) are the same week.
    const points = buildFinancialSeries(
      [sale('2026-07-20', 1000), sale('2026-07-24', 3000)],
      [labor('2026-07-20', 220, 40), labor('2026-07-24', 660, 120)],
      'week',
      22,
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      bucketStart: '2026-07-20',
      sales: 4000,
      laborCost: 880,
      laborHours: 160,
      laborPct: 22,
    });
  });

  it('month granularity: aggregates all days in the same calendar month', () => {
    const points = buildFinancialSeries(
      [sale('2026-07-01', 1000), sale('2026-07-31', 1000)],
      [labor('2026-07-01', 200, 30), labor('2026-07-31', 200, 30)],
      'month',
      22,
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      bucketStart: '2026-07',
      sales: 2000,
      laborCost: 400,
      laborHours: 60,
      laborPct: 20,
    });
  });

  it('a 0-sales bucket yields null laborPct, never Infinity', () => {
    const points = buildFinancialSeries([], [labor('2026-07-20', 300, 20)], 'day', 22);
    expect(points).toEqual([
      {
        bucketStart: '2026-07-20',
        label: '2026-07-20',
        sales: 0,
        laborCost: 300,
        laborHours: 20,
        laborPct: null,
        balanceState: 'balanced',
      },
    ]);
  });

  it('outer join: a day with sales but no labor row still appears, with laborCost/Hours 0', () => {
    const points = buildFinancialSeries([sale('2026-07-20', 500)], [], 'day', 22);
    expect(points).toEqual([
      {
        bucketStart: '2026-07-20',
        label: '2026-07-20',
        sales: 500,
        laborCost: 0,
        laborHours: 0,
        laborPct: 0,
        balanceState: 'under',
      },
    ]);
  });

  it('outer join: buckets are sorted ascending across mixed sales-only and labor-only days', () => {
    const points = buildFinancialSeries(
      [sale('2026-07-22', 500)],
      [labor('2026-07-19', 100, 10)],
      'day',
      22,
    );
    expect(points.map((p) => p.bucketStart)).toEqual(['2026-07-19', '2026-07-22']);
  });
});

describe('buildSalesVolumeGrid', () => {
  it('normalizes intensity 0..1 against the window max cell', () => {
    const cells = buildSalesVolumeGrid(
      [gridCell(1, 12, 100), gridCell(1, 13, 50), gridCell(1, 14, 25)],
      false,
    );
    expect(cells.map((c) => c.intensity)).toEqual([1, 0.5, 0.25]);
    expect(cells.map((c) => c.totalSales)).toEqual([100, 50, 25]);
    expect(cells.map((c) => ({ dow: c.dow, hour: c.hour }))).toEqual([
      { dow: 1, hour: 12 },
      { dow: 1, hour: 13 },
      { dow: 1, hour: 14 },
    ]);
  });

  it('flags peak at/above 72% of the window max, and not below it', () => {
    const cells = buildSalesVolumeGrid(
      [gridCell(1, 12, 100), gridCell(1, 13, 72), gridCell(1, 14, 71.99), gridCell(1, 15, 0)],
      false,
    );
    expect(cells.map((c) => c.peak)).toEqual([true, true, false, false]);
  });

  it('passes the estimated flag through to every cell', () => {
    const withEstimate = buildSalesVolumeGrid([gridCell(0, 9, 10), gridCell(0, 10, 20)], true);
    expect(withEstimate.every((c) => c.estimated === true)).toBe(true);

    const withoutEstimate = buildSalesVolumeGrid([gridCell(0, 9, 10)], false);
    expect(withoutEstimate[0].estimated).toBe(false);
  });

  it('handles an all-zero window without producing NaN intensities or peaks', () => {
    const cells = buildSalesVolumeGrid([gridCell(0, 0, 0), gridCell(0, 1, 0)], false);
    expect(cells.every((c) => c.intensity === 0)).toBe(true);
    expect(cells.every((c) => c.peak === false)).toBe(true);
    expect(cells.every((c) => Number.isNaN(c.intensity) === false)).toBe(true);
  });

  it('handles an empty cells array', () => {
    expect(buildSalesVolumeGrid([], false)).toEqual([]);
  });
});
