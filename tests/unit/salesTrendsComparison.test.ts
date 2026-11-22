import { describe, it, expect } from 'vitest';
import {
  computeKpiDelta,
  attachPriorSeries,
  type DailySeriesRow,
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
