import { describe, expect, it } from 'vitest';

import {
  parseHourlySalesArgs,
  resolveWindow,
  maxByDateDays,
  formatHourlySales,
  type HourlySalesArgs,
  type RpcResult,
} from '../../supabase/functions/_shared/hourlySalesTool';
import { recommendForSlots, recommendStaffForHour } from '../../supabase/functions/_shared/hourlyStaffing';

describe('parseHourlySalesArgs', () => {
  it('defaults view, interval_minutes, and the optional fields', () => {
    const result = parseHourlySalesArgs({});
    expect(result).toEqual({
      ok: true,
      value: { view: 'weekday', interval_minutes: 60, lookback_weeks: undefined, start_date: undefined, end_date: undefined, day_of_week: undefined },
    });
  });

  it('rejects a bad view', () => {
    const result = parseHourlySalesArgs({ view: 'monthly' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENTS');
  });

  it('rejects a bad interval_minutes', () => {
    const result = parseHourlySalesArgs({ interval_minutes: 45 });
    expect(result.ok).toBe(false);
  });

  it('rejects a lookback_weeks below 1', () => {
    const result = parseHourlySalesArgs({ lookback_weeks: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a lookback_weeks above 12', () => {
    const result = parseHourlySalesArgs({ lookback_weeks: 13 });
    expect(result.ok).toBe(false);
  });

  it('rejects a day_of_week outside 0-6', () => {
    const result = parseHourlySalesArgs({ day_of_week: 7 });
    expect(result.ok).toBe(false);
  });

  it('rejects a start_date that is not YYYY-MM-DD', () => {
    const result = parseHourlySalesArgs({ start_date: '09/01/2026' });
    expect(result.ok).toBe(false);
  });

  it('rejects an end_date that is not YYYY-MM-DD', () => {
    const result = parseHourlySalesArgs({ end_date: 'not-a-date' });
    expect(result.ok).toBe(false);
  });

  it('rejects a start_date that is not a real calendar date', () => {
    const result = parseHourlySalesArgs({ start_date: '2026-02-30' });
    expect(result.ok).toBe(false);
  });

  it('rejects an end_date that is not a real calendar date', () => {
    const result = parseHourlySalesArgs({ end_date: '2026-13-01' });
    expect(result.ok).toBe(false);
  });

  it('rejects end_date before start_date', () => {
    const result = parseHourlySalesArgs({ start_date: '2026-09-10', end_date: '2026-09-01' });
    expect(result.ok).toBe(false);
  });

  it('accepts a valid full set of arguments', () => {
    const result = parseHourlySalesArgs({
      view: 'by_date',
      interval_minutes: 30,
      start_date: '2026-09-01',
      end_date: '2026-09-05',
      day_of_week: 3,
    });
    expect(result.ok).toBe(true);
  });
});

describe('maxByDateDays', () => {
  it('is 31 days at 60 minutes', () => {
    expect(maxByDateDays(60)).toBe(31);
  });

  it('is 15 days at 30 minutes', () => {
    expect(maxByDateDays(30)).toBe(15);
  });

  it('is 7 days at 15 minutes', () => {
    expect(maxByDateDays(15)).toBe(7);
  });
});

describe('resolveWindow', () => {
  const today = '2026-09-28';

  it('weekday view: end is today, start is lookback_weeks x 7 days back', () => {
    const args: HourlySalesArgs = { view: 'weekday', interval_minutes: 60, lookback_weeks: 4 };
    const result = resolveWindow(args, today, 4);
    expect(result).toEqual({ ok: true, value: { start_date: '2026-08-31', end_date: '2026-09-28', lookback_weeks: 4 } });
  });

  it('weekday view: falls back to the restaurant default lookback_weeks', () => {
    const args: HourlySalesArgs = { view: 'weekday', interval_minutes: 60 };
    const result = resolveWindow(args, today, 6);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.lookback_weeks).toBe(6);
  });

  it('by_date view: defaults to the last 7 days ending today', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 60 };
    const result = resolveWindow(args, today, 4);
    expect(result).toEqual({ ok: true, value: { start_date: '2026-09-22', end_date: '2026-09-28' } });
  });

  it('by_date view: within the 31-day limit at 60 minutes passes', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 60, start_date: '2026-08-29', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(true);
  });

  it('by_date view: above the 31-day limit at 60 minutes is INVALID_ARGUMENTS', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 60, start_date: '2026-08-28', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_ARGUMENTS');
  });

  it('by_date view: above the 15-day limit at 30 minutes is INVALID_ARGUMENTS', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 30, start_date: '2026-09-12', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(false);
  });

  it('by_date view: at the 15-day limit at 30 minutes passes', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 30, start_date: '2026-09-14', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(true);
  });

  it('by_date view: above the 7-day limit at 15 minutes is INVALID_ARGUMENTS', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 15, start_date: '2026-09-20', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(false);
  });

  it('by_date view: at the 7-day limit at 15 minutes passes', () => {
    const args: HourlySalesArgs = { view: 'by_date', interval_minutes: 15, start_date: '2026-09-22', end_date: '2026-09-28' };
    const result = resolveWindow(args, today, 4);
    expect(result.ok).toBe(true);
  });
});

describe('formatHourlySales', () => {
  it('sub-hour rows take the recommendation of the hour that contains them', () => {
    // 60-minute hourly sales for the containing recommendation.
    const hourly = [{ hour: 16, avgSales: 300 }];
    const settings = { targetSplh: 60, minStaff: 1, minCrew: null };
    // The 16:00 hour recommends ceil(300/60)=5 staff.
    const expectedStaff = recommendStaffForHour(300, 60, 1);

    const rpc: RpcResult = {
      time_zone: 'America/Chicago',
      view: 'weekday',
      interval_minutes: 30,
      start_date: '2026-08-31',
      end_date: '2026-09-28',
      total_sales: 1000,
      days: [
        {
          day_of_week: 1,
          date: null,
          sample_days: 4,
          day_total: null,
          has_hourly_breakdown: true,
          slots: [
            { start_minute: 960, sales: 120.5, sample_count: 4 }, // 16:00, sub-hour sales differ from hourly
            { start_minute: 990, sales: 90.75, sample_count: 4 }, // 16:30
          ],
        },
      ],
    };

    const recommend = (_dayKey: string, startMinute: number, _slotSales: number) => {
      const recs = recommendForSlots([{ startMinute }], hourly, settings);
      return recs[0].recommendedStaff;
    };

    const out = formatHourlySales(rpc, { target_splh: 60, min_staff: 1 }, recommend);
    const days = out.days as { rows: number[][] }[];
    const day = days[0];
    // Both sub-hour rows use the containing hour's recommendation, not one
    // computed from each slot's own (differing) sales value.
    expect(day.rows[0][3]).toBe(expectedStaff);
    expect(day.rows[1][3]).toBe(expectedStaff);
  });

  it('marks a fallback day with the fallback note', () => {
    const rpc: RpcResult = {
      time_zone: 'America/Chicago',
      view: 'weekday',
      interval_minutes: 60,
      start_date: '2026-08-31',
      end_date: '2026-09-28',
      total_sales: 500,
      days: [
        {
          day_of_week: 2,
          date: null,
          sample_days: 1,
          day_total: null,
          has_hourly_breakdown: false,
          slots: [{ start_minute: 540, sales: 38.46, sample_count: 1 }],
        },
      ],
    };
    const out = formatHourlySales(rpc, { target_splh: 60, min_staff: 1 }, () => 1);
    expect(out.notes).toEqual(
      expect.arrayContaining([expect.stringMatching(/no hourly data/)]),
    );
  });

  it('has no fallback note when every day has an hourly breakdown', () => {
    const rpc: RpcResult = {
      time_zone: 'America/Chicago',
      view: 'weekday',
      interval_minutes: 60,
      start_date: '2026-08-31',
      end_date: '2026-09-28',
      total_sales: 500,
      days: [
        {
          day_of_week: 2,
          date: null,
          sample_days: 4,
          day_total: null,
          has_hourly_breakdown: true,
          slots: [{ start_minute: 540, sales: 38.46, sample_count: 4 }],
        },
      ],
    };
    const out = formatHourlySales(rpc, { target_splh: 60, min_staff: 1 }, () => 1);
    expect((out.notes as string[]).some((n) => /no hourly data/.test(n))).toBe(false);
  });

  it('formats the worst-case output (every slot filled, largest values, max days) under 40,000 characters', () => {
    const intervalMinutes = 60;
    const maxDays = maxByDateDays(intervalMinutes);
    const slotsPerDay = (22 - 9); // 09:00..21:00, one row per hour, matches the design's byte budget

    const days = Array.from({ length: maxDays }, (_, i) => {
      const date = `2026-09-${String((i % 28) + 1).padStart(2, '0')}`;
      const slots = Array.from({ length: slotsPerDay }, (_, h) => ({
        start_minute: (9 + h) * 60,
        sales: 99999.99,
        sample_count: 99,
      }));
      return {
        day_of_week: i % 7,
        date,
        sample_days: null,
        day_total: 999999.99,
        has_hourly_breakdown: true,
        slots,
      };
    });

    const rpc: RpcResult = {
      time_zone: 'America/Chicago',
      view: 'by_date',
      interval_minutes: intervalMinutes,
      start_date: '2026-09-01',
      end_date: '2026-09-28',
      total_sales: 999999.99,
      days,
    };

    const out = formatHourlySales(rpc, { target_splh: 60, min_staff: 1 }, () => 999);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(40_000);
  });
});
