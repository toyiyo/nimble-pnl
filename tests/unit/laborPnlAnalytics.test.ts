import { describe, it, expect } from 'vitest';
import {
  classifyBalance,
  LABOR_BALANCE_BAND,
  monthKeyOf,
  bucketKeyOf,
  bucketKeyComparator,
  balanceStateClassName,
  buildFinancialSeries,
  buildSalesVolumeGrid,
  summarizeLaborPnl,
} from '@/lib/laborPnlAnalytics';
import type { SplhPoint, SplhGridCell } from '@/lib/splhAnalytics';
import type { LaborCostData } from '@/hooks/useLaborCostsFromTimeTracking';
import type { FinancialPoint, BalanceState } from '@/lib/laborPnlAnalytics';

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

function point(
  bucketStart: string,
  sales: number,
  laborCost: number,
  laborHours: number,
  balanceState: BalanceState,
): FinancialPoint {
  const laborPct = sales > 0 ? Math.round((laborCost / sales) * 10000) / 100 : null;
  return { bucketStart, label: bucketStart, sales, laborCost, laborHours, laborPct, balanceState };
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

describe('summarizeLaborPnl', () => {
  it('returns a none-tone, no-data verdict for an empty series', () => {
    expect(summarizeLaborPnl([], 22)).toEqual({
      sales: 0,
      laborCost: 0,
      laborPct: null,
      revPerLaborHr: null,
      verdict: 'Not enough data to assess labor yet.',
      verdictTone: 'none',
      overWindows: [],
      underWindows: [],
    });
  });

  it('returns a none-tone verdict when the series has no sales (laborPct null)', () => {
    const points = [point('2026-07-20', 0, 300, 20, 'balanced')];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.laborPct).toBeNull();
    expect(summary.verdictTone).toBe('none');
    expect(summary.verdict).toBe('Not enough data to assess labor yet.');
  });

  it('sums totals and computes revPerLaborHr across buckets (balanced tone)', () => {
    const points = [
      point('2026-07-20', 1000, 220, 40, 'balanced'),
      point('2026-07-21', 2000, 440, 80, 'balanced'),
    ];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.sales).toBe(3000);
    expect(summary.laborCost).toBe(660);
    expect(summary.laborPct).toBe(22);
    expect(summary.revPerLaborHr).toBe(25);
    expect(summary.verdictTone).toBe('balanced');
    expect(summary.verdict).toBe(
      'Labor ran 22% of sales — right on your 22% target. Team earned $25/labor-hour.',
    );
  });

  it('produces an over-tone verdict with the pt delta over target', () => {
    const points = [point('2026-07-20', 1000, 300, 10, 'over')];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.verdictTone).toBe('over');
    expect(summary.revPerLaborHr).toBe(100);
    expect(summary.verdict).toBe(
      'Labor ran 30% of sales — 8pt over target. Team earned $100/labor-hour.',
    );
  });

  it('produces an under-tone verdict with the pt delta under target', () => {
    const points = [point('2026-07-20', 1000, 100, 20, 'under')];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.verdictTone).toBe('under');
    expect(summary.revPerLaborHr).toBe(50);
    expect(summary.verdict).toBe(
      'Labor ran 10% of sales — 12pt under target. Team earned $50/labor-hour.',
    );
  });

  it('guards 0 labor hours: revPerLaborHr is null and the $/labor-hour clause is omitted', () => {
    const points = [point('2026-07-20', 1000, 220, 0, 'balanced')];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.laborPct).toBe(22);
    expect(summary.revPerLaborHr).toBeNull();
    expect(summary.verdictTone).toBe('balanced');
    expect(summary.verdict).toBe('Labor ran 22% of sales — right on your 22% target.');
  });

  it('extracts contiguous over/under windows in bucket order, skipping balanced runs', () => {
    const points = [
      point('2026-07-20', 1000, 100, 20, 'under'),
      point('2026-07-21', 1000, 220, 20, 'balanced'),
      point('2026-07-22', 1000, 300, 20, 'over'),
      point('2026-07-23', 1000, 300, 20, 'over'),
      point('2026-07-24', 1000, 100, 20, 'under'),
    ];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.overWindows).toEqual([
      { startLabel: '2026-07-22', endLabel: '2026-07-23', bucketCount: 2 },
    ]);
    expect(summary.underWindows).toEqual([
      { startLabel: '2026-07-20', endLabel: '2026-07-20', bucketCount: 1 },
      { startLabel: '2026-07-24', endLabel: '2026-07-24', bucketCount: 1 },
    ]);
  });

  it('extracts a trailing run that runs to the end of the series', () => {
    const points = [
      point('2026-07-20', 1000, 220, 20, 'balanced'),
      point('2026-07-21', 1000, 300, 20, 'over'),
    ];
    const summary = summarizeLaborPnl(points, 22);
    expect(summary.overWindows).toEqual([
      { startLabel: '2026-07-21', endLabel: '2026-07-21', bucketCount: 1 },
    ]);
  });
});

describe('bucketKeyComparator', () => {
  it('sorts ISO day bucket keys chronologically', () => {
    const keys = ['2026-07-21', '2026-01-05', '2026-07-20', '2025-12-31'];
    expect([...keys].sort(bucketKeyComparator)).toEqual([
      '2025-12-31',
      '2026-01-05',
      '2026-07-20',
      '2026-07-21',
    ]);
  });

  it('sorts YYYY-MM month bucket keys across a year boundary', () => {
    const keys = ['2026-02', '2025-11', '2026-01', '2025-12'];
    expect([...keys].sort(bucketKeyComparator)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });

  it('is a plain (a, b) => number comparator usable directly as Array.sort\'s argument', () => {
    expect(bucketKeyComparator('2026-07-20', '2026-07-20')).toBe(0);
    expect(bucketKeyComparator('2026-07-19', '2026-07-20')).toBeLessThan(0);
    expect(bucketKeyComparator('2026-07-21', '2026-07-20')).toBeGreaterThan(0);
  });
});

describe('balanceStateClassName', () => {
  it('maps over to the --labor-over token', () => {
    expect(balanceStateClassName('over')).toBe('text-[hsl(var(--labor-over))]');
  });

  it('maps under to the --labor-under token', () => {
    expect(balanceStateClassName('under')).toBe('text-[hsl(var(--labor-under))]');
  });

  it('maps balanced to the --labor-balanced token', () => {
    expect(balanceStateClassName('balanced')).toBe('text-[hsl(var(--labor-balanced))]');
  });

  it('maps none to an empty string so callers fall back to their default className', () => {
    expect(balanceStateClassName('none')).toBe('');
  });
});

// --- Current-period window + intraday series (design §2.2 toggle) ----------

import {
  currentPeriodWindow,
  dateInWindow,
  buildIntradayFinancialSeries,
  extractBalanceWindows,
} from '@/lib/laborPnlAnalytics';
import { mondayOf } from '@/lib/splhAnalytics';
import type { SplhSaleRow } from '@/lib/splhAnalytics';
import type { WorkSession } from '@/utils/timePunchProcessing';

function saleRow(sale_date: string, sold_at: string | null, total_price: number): SplhSaleRow {
  return { sale_date, sale_time: null, sold_at, total_price };
}

function workSession(clockIn: string, clockOut: string): WorkSession {
  return {
    sessionId: clockIn,
    employee_id: 'e1',
    employee_name: 'E',
    clock_in: new Date(clockIn),
    clock_out: new Date(clockOut),
    breaks: [],
    total_minutes: 0,
    break_minutes: 0,
    worked_minutes: 0,
    is_complete: true,
    has_anomalies: false,
    anomalies: [],
  };
}

describe('currentPeriodWindow', () => {
  it('day → today..today', () => {
    expect(currentPeriodWindow('day', '2026-07-22')).toEqual({ startStr: '2026-07-22', endStr: '2026-07-22' });
  });

  it('week → Monday-of-week..today (reuses splhAnalytics.mondayOf)', () => {
    const today = '2026-07-22';
    expect(currentPeriodWindow('week', today)).toEqual({ startStr: mondayOf(today), endStr: today });
  });

  it('month → first-of-month..today', () => {
    expect(currentPeriodWindow('month', '2026-07-22')).toEqual({ startStr: '2026-07-01', endStr: '2026-07-22' });
  });
});

describe('dateInWindow', () => {
  it('is inclusive of both bounds', () => {
    expect(dateInWindow('2026-07-01', '2026-07-01', '2026-07-31')).toBe(true);
    expect(dateInWindow('2026-07-31', '2026-07-01', '2026-07-31')).toBe(true);
  });
  it('excludes dates outside the window', () => {
    expect(dateInWindow('2026-06-30', '2026-07-01', '2026-07-31')).toBe(false);
    expect(dateInWindow('2026-08-01', '2026-07-01', '2026-07-31')).toBe(false);
  });
});

describe('buildIntradayFinancialSeries', () => {
  const tz = 'UTC';
  const day = '2026-07-22';

  it('buckets a day’s sales + worked hours by hour, pricing labor at the avg rate (shape)', () => {
    const sales = [saleRow(day, `${day}T18:30:00Z`, 200)];
    const sessions = [workSession(`${day}T18:00:00Z`, `${day}T20:00:00Z`)];
    // avg rate $20/hr; target 22%
    const series = buildIntradayFinancialSeries(sales, sessions, tz, day, 2000, 22);

    // contiguous 18..19 (sales at 18, labor at 18 and 19)
    expect(series.map((p) => p.label)).toEqual(['6 PM', '7 PM']);

    const h18 = series[0];
    expect(h18.sales).toBe(200);
    expect(h18.laborHours).toBe(1);
    expect(h18.laborCost).toBe(20);
    expect(h18.laborPct).toBe(10); // 20/200
    expect(h18.balanceState).toBe('under'); // 10 < 22-6

    const h19 = series[1];
    expect(h19.sales).toBe(0);
    expect(h19.laborHours).toBe(1);
    expect(h19.laborPct).toBeNull(); // no sales → never Infinity
    expect(h19.balanceState).toBe('balanced');
  });

  it('skips sales whose hour is not derivable and ignores other dates', () => {
    const sales = [
      saleRow(day, null, 500), // no sold_at/sale_time → no hour
      saleRow('2026-07-21', `2026-07-21T12:00:00Z`, 999), // different date
    ];
    const sessions = [workSession(`${day}T12:00:00Z`, `${day}T13:00:00Z`)];
    const series = buildIntradayFinancialSeries(sales, sessions, tz, day, 2000, 22);
    // only the labor hour 12 is active; no sales bucketed
    expect(series.map((p) => p.label)).toEqual(['12 PM']);
    expect(series[0].sales).toBe(0);
    expect(series[0].laborHours).toBe(1);
  });

  it('returns [] when the day has no sales and no labor', () => {
    expect(buildIntradayFinancialSeries([], [], tz, day, 2000, 22)).toEqual([]);
  });
});

describe('extractBalanceWindows (exported for hook-level series windows)', () => {
  it('collapses contiguous same-state runs', () => {
    const pts = [
      point('a', 100, 40, 4, 'over'),
      point('b', 100, 40, 4, 'over'),
      point('c', 100, 20, 2, 'balanced'),
      point('d', 100, 5, 1, 'under'),
    ];
    const over = extractBalanceWindows(pts, 'over');
    expect(over).toEqual([{ startLabel: 'a', endLabel: 'b', bucketCount: 2 }]);
    const under = extractBalanceWindows(pts, 'under');
    expect(under).toEqual([{ startLabel: 'd', endLabel: 'd', bucketCount: 1 }]);
  });
});
