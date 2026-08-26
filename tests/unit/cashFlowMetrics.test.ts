import { describe, it, expect } from 'vitest';
import { deriveCashFlowMetrics, type DailyFlow } from '@/lib/cashFlowMetrics';

// Local-date helper. Avoids `new Date('2026-08-01')`, which parses as UTC
// midnight and can render as the previous day in a TZ behind UTC.
function d(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day);
}

describe('deriveCashFlowMetrics', () => {
  it('sums inflow and outflow over the full period, not a fixed window', () => {
    // 10-day period, 2026-08-01..2026-08-10. Flat $100 inflow every day.
    const daily: DailyFlow[] = Array.from({ length: 10 }, (_, i) => ({
      day: `2026-08-${String(i + 1).padStart(2, '0')}`,
      inflow: 100,
      outflow: 0,
    }));

    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 10));

    expect(metrics.totalInflows).toBe(1000);
    expect(metrics.totalOutflows).toBe(0);
    expect(metrics.netCashFlow).toBe(1000);
  });

  it('computes volatility over days present in the series, not zero-filled gaps', () => {
    // 3-day period, day 2 has no row at all.
    const daily: DailyFlow[] = [
      { day: '2026-08-01', inflow: 100, outflow: 0 },
      { day: '2026-08-03', inflow: 0, outflow: 100 },
    ];

    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 3));

    // Net flows [100, -100], mean 0, population variance = (100^2 + 100^2) / 2 = 10000.
    expect(metrics.volatility).toBeCloseTo(100, 10);
  });

  it('zero-fills the trend array for days with no matching row', () => {
    // 14-day period so trendDays = min(14, periodDays) = 14, one row per pair
    // of days, matching the last day of the period.
    const daily: DailyFlow[] = [
      { day: '2026-08-01', inflow: 50, outflow: 0 },
      { day: '2026-08-03', inflow: 0, outflow: 20 },
      { day: '2026-08-14', inflow: 10, outflow: 0 },
    ];

    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 14));

    expect(metrics.trend).toHaveLength(14);
    // Oldest to newest: 08-01=50, 08-02=0 (absent), 08-03=-20, 08-04..08-13=0, 08-14=10.
    expect(metrics.trend[0]).toBe(50);
    expect(metrics.trend[1]).toBe(0);
    expect(metrics.trend[2]).toBe(-20);
    expect(metrics.trend.slice(3, 13)).toEqual(new Array(10).fill(0));
    expect(metrics.trend[13]).toBe(10);
  });

  it('caps the trend array at the period length when it is under 14 days', () => {
    const daily: DailyFlow[] = [{ day: '2026-08-02', inflow: 40, outflow: 0 }];

    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 3));

    expect(metrics.trend).toHaveLength(3);
    expect(metrics.trend).toEqual([0, 40, 0]);
  });

  it('compares period inflow to the comparison inflow for the trailing percentage', () => {
    const daily: DailyFlow[] = [{ day: '2026-08-01', inflow: 300, outflow: 0 }];

    const metrics = deriveCashFlowMetrics(daily, 200, d(2026, 8, 1), d(2026, 8, 1));

    expect(metrics.trailingTrendPercentage).toBeCloseTo(50, 10);
  });

  it('guards the trailing percentage at zero when the comparison inflow is zero', () => {
    const daily: DailyFlow[] = [{ day: '2026-08-01', inflow: 300, outflow: 0 }];

    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 1));

    expect(metrics.trailingTrendPercentage).toBe(0);
  });

  it('divides the period net by the period day count for avgDailyCashFlow', () => {
    const daily: DailyFlow[] = [
      { day: '2026-08-01', inflow: 500, outflow: 0 },
      { day: '2026-08-05', inflow: 0, outflow: 100 },
    ];

    // 5-day period: 2026-08-01..2026-08-05. Net = 500 - 100 = 400.
    const metrics = deriveCashFlowMetrics(daily, 0, d(2026, 8, 1), d(2026, 8, 5));

    expect(metrics.avgDailyCashFlow).toBe(80);
  });

  it('returns zeroed metrics for an empty series', () => {
    const metrics = deriveCashFlowMetrics([], 0, d(2026, 8, 1), d(2026, 8, 5));

    expect(metrics).toEqual({
      totalInflows: 0,
      totalOutflows: 0,
      netCashFlow: 0,
      avgDailyCashFlow: 0,
      volatility: 0,
      trend: [0, 0, 0, 0, 0],
      trailingTrendPercentage: 0,
    });
  });
});
