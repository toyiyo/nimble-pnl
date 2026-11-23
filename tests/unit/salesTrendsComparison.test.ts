import { describe, it, expect } from 'vitest';
import {
  computeKpiDelta,
  attachPriorSeries,
  attachPriorHourlySeries,
  buildHourlySeries,
  countDaysInRange,
  priorDayScale,
  type DailySeriesRow,
  type SalesTrendsHourRow,
} from '@/lib/salesTrends';

describe('computeKpiDelta', () => {
  it('returns a positive change and percent', () => {
    expect(computeKpiDelta(110, 100)).toEqual({ change: 10, percent: 10 });
  });
  it('returns a negative change and percent', () => {
    expect(computeKpiDelta(90, 100)).toEqual({ change: -10, percent: -10 });
  });
  it('returns a null percent when the prior value is 0', () => {
    expect(computeKpiDelta(5, 0)).toEqual({ change: 5, percent: null });
  });
  it('returns change 0 and a null percent when both values are 0', () => {
    expect(computeKpiDelta(0, 0)).toEqual({ change: 0, percent: null });
  });
  it('divides by the signed prior value when the prior value is negative', () => {
    // A refund-heavy prior period: change 50 over prior -100 gives -50%.
    expect(computeKpiDelta(-50, -100)).toEqual({ change: 50, percent: -50 });
  });
  it('returns a decrease above 100 percent when the current value is negative', () => {
    expect(computeKpiDelta(-20, 100)).toEqual({ change: -120, percent: -120 });
  });
});

describe('attachPriorSeries', () => {
  const daily: DailySeriesRow[] = [
    { date: '2024-08-08', total: 10 },
    { date: '2024-08-09', total: 20 },
    { date: '2024-08-10', total: 30 },
  ];
  const prior: DailySeriesRow[] = [
    { date: '2024-08-01', total: 1 },
    { date: '2024-08-02', total: 2 },
  ];

  it('pairs rows by index and adds prior and priorDate', () => {
    const out = attachPriorSeries(daily, prior);
    expect(out[0]).toMatchObject({ date: '2024-08-08', total: 10, prior: 1, priorDate: '2024-08-01' });
    expect(out[1]).toMatchObject({ prior: 2, priorDate: '2024-08-02' });
  });
  it('leaves extra current rows without a prior key', () => {
    const out = attachPriorSeries(daily, prior);
    expect('prior' in out[2]).toBe(false);
    expect('priorDate' in out[2]).toBe(false);
  });
  it('returns the rows unchanged when the prior series is undefined', () => {
    expect(attachPriorSeries(daily, undefined)).toEqual(daily);
  });
  it('returns an empty array when there are no current rows', () => {
    expect(attachPriorSeries([], prior)).toEqual([]);
  });
  it('adds no prior key when the prior series is empty', () => {
    const out = attachPriorSeries(daily, []);
    expect(out).toEqual(daily);
    expect(out.some((row) => 'prior' in row)).toBe(false);
  });
});

describe('countDaysInRange', () => {
  it('counts both ends of the range', () => {
    expect(countDaysInRange('2026-06-01', '2026-06-30')).toBe(30);
    expect(countDaysInRange('2026-06-01', '2026-06-01')).toBe(1);
  });

  it('counts a leap day and a DST change as one day each', () => {
    expect(countDaysInRange('2024-02-01', '2024-02-29')).toBe(29);
    expect(countDaysInRange('2026-03-01', '2026-03-31')).toBe(31);
  });

  it('returns 0 for an end date before the start date', () => {
    expect(countDaysInRange('2026-06-02', '2026-06-01')).toBe(0);
  });
});

describe('priorDayScale', () => {
  it('returns 1 when the two ranges have the same length', () => {
    expect(
      priorDayScale({ start: '2026-06-08', end: '2026-06-14' }, { start: '2026-06-01', end: '2026-06-07' }),
    ).toBe(1);
  });

  it('scales a 28-day prior period to a 31-day current period', () => {
    expect(
      priorDayScale({ start: '2026-03-01', end: '2026-03-31' }, { start: '2026-02-01', end: '2026-02-28' }),
    ).toBeCloseTo(31 / 28);
  });

  it('returns 1 when a range is empty', () => {
    expect(
      priorDayScale({ start: '2026-03-02', end: '2026-03-01' }, { start: '2026-02-01', end: '2026-02-28' }),
    ).toBe(1);
  });
});

describe('attachPriorHourlySeries', () => {
  const currentRows: SalesTrendsHourRow[] = [
    { hour: 11, pos_system: 'toast', revenue: 100, day_count: 2 },
    { hour: 18, pos_system: 'square', revenue: 50, day_count: 1 },
  ];
  const hourly = buildHourlySeries(currentRows, ['toast', 'square']);
  const priorRows: SalesTrendsHourRow[] = [
    { hour: 11, pos_system: 'toast', revenue: 60, day_count: 2 },
    { hour: 11, pos_system: 'square', revenue: 20, day_count: 1 },
    { hour: 20, pos_system: 'toast', revenue: 10, day_count: 1 },
  ];

  it('adds the prior total of each hour, summed over POS systems', () => {
    const out = attachPriorHourlySeries(hourly, priorRows, 1);
    expect(out).toHaveLength(24);
    expect(out[11].prior).toBe(80);
    expect(out[20].prior).toBe(10);
    expect(out[3].prior).toBe(0);
    expect(out[11].total).toBe(100);
  });

  it('multiplies the prior totals by the scale factor', () => {
    const out = attachPriorHourlySeries(hourly, priorRows, 1.5);
    expect(out[11].prior).toBe(120);
    expect(out[20].prior).toBe(15);
  });

  it('adds no prior key when the prior period has no hour rows', () => {
    expect(attachPriorHourlySeries(hourly, [], 1)).toBe(hourly);
    expect(attachPriorHourlySeries(hourly, undefined, 1)).toBe(hourly);
  });

  it('rounds the scaled prior value to cents', () => {
    const out = attachPriorHourlySeries(hourly, priorRows, 31 / 30);
    // 80 x 31 / 30 = 82.6666...
    expect(out[11].prior).toBe(82.67);
  });

  it('returns an empty series when the current period has no hour rows', () => {
    expect(attachPriorHourlySeries([], priorRows, 1)).toEqual([]);
  });
});
