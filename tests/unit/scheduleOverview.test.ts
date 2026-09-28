import { describe, it, expect } from 'vitest';
import { groupShiftsByRestaurantDay, scheduleOverviewDays } from '../../supabase/functions/_shared/scheduleOverview';
import { calculateDateRange } from '../../supabase/functions/_shared/restaurantDate';

describe('groupShiftsByRestaurantDay', () => {
  it('groups a shift at 21:00 CDT (crosses to the next UTC day) under the Chicago day', () => {
    const shifts = [
      {
        id: 's1',
        start_time: '2026-09-26T02:00:00Z',
        end_time: '2026-09-26T06:00:00Z',
        status: 'published',
        position: 'Server',
        employee: { name: 'Ana', position: 'Server' },
      },
    ];
    const byDate = groupShiftsByRestaurantDay(shifts, 'America/Chicago');
    expect(Object.keys(byDate)).toEqual(['2026-09-25']);
  });

  it('groups a shift at 22:00 CDT under the Chicago day', () => {
    const shifts = [
      {
        id: 's2',
        start_time: '2026-09-27T03:00:00Z',
        end_time: '2026-09-27T07:00:00Z',
        status: 'published',
        position: 'Cook',
        employee: { name: 'Bo', position: 'Cook' },
      },
    ];
    const byDate = groupShiftsByRestaurantDay(shifts, 'America/Chicago');
    expect(Object.keys(byDate)).toEqual(['2026-09-26']);
  });

  it('groups the same instant under the UTC day for a UTC restaurant', () => {
    const shifts = [
      {
        id: 's3',
        start_time: '2026-09-26T02:00:00Z',
        end_time: '2026-09-26T06:00:00Z',
        status: 'published',
        position: 'Server',
        employee: { name: 'Ana', position: 'Server' },
      },
    ];
    const byDate = groupShiftsByRestaurantDay(shifts, 'UTC');
    expect(Object.keys(byDate)).toEqual(['2026-09-26']);
  });

  it('gives the exact row shape and keeps the query order within each day', () => {
    const shifts = [
      {
        id: 's1',
        start_time: '2026-09-26T02:00:00Z',
        end_time: '2026-09-26T06:00:00Z',
        status: 'published',
        position: 'Server',
        employee: { name: 'Ana', position: 'Server' },
      },
      {
        id: 's4',
        start_time: '2026-09-26T04:00:00Z',
        end_time: '2026-09-26T08:00:00Z',
        status: 'draft',
        position: null,
        employee: { name: 'Cy', position: 'Host' },
      },
    ];
    const byDate = groupShiftsByRestaurantDay(shifts, 'America/Chicago');
    expect(byDate['2026-09-25']).toEqual([
      {
        id: 's1',
        employee_name: 'Ana',
        position: 'Server',
        start_time: '2026-09-26T02:00:00Z',
        end_time: '2026-09-26T06:00:00Z',
        status: 'published',
      },
      {
        id: 's4',
        employee_name: 'Cy',
        position: 'Host',
        start_time: '2026-09-26T04:00:00Z',
        end_time: '2026-09-26T08:00:00Z',
        status: 'draft',
      },
    ]);
  });

  it('falls back to Unknown employee_name when a shift has no employee, like the current executor', () => {
    const shifts = [
      {
        id: 's5',
        start_time: '2026-09-26T02:00:00Z',
        end_time: '2026-09-26T06:00:00Z',
        status: 'published',
        position: 'Server',
        employee: null,
      },
    ];
    const byDate = groupShiftsByRestaurantDay(shifts, 'America/Chicago');
    expect(byDate['2026-09-25'][0].employee_name).toBe('Unknown');
  });
});

describe('scheduleOverviewDays', () => {
  it("gives today..+7 for period 'week', using the Chicago wall clock", () => {
    const now = new Date(2026, 8, 25, 21, 0, 0); // wall clock: 2026-09-25 21:00
    const { startDateStr, endDateStr } = scheduleOverviewDays('week', undefined, undefined, now);
    expect(startDateStr).toBe('2026-09-25');
    expect(endDateStr).toBe('2026-10-02');
  });

  it("gives today..+1 month for period 'month'", () => {
    const now = new Date(2026, 8, 25, 21, 0, 0);
    const { startDateStr, endDateStr } = scheduleOverviewDays('month', undefined, undefined, now);
    expect(startDateStr).toBe('2026-09-25');
    expect(endDateStr).toBe('2026-10-25');
  });

  it("clamps period 'month' to the target month's last day (Jan 31 -> Feb 28)", () => {
    const now = new Date(2026, 0, 31, 21, 0, 0); // wall clock: 2026-01-31 21:00
    const { startDateStr, endDateStr } = scheduleOverviewDays('month', undefined, undefined, now);
    expect(startDateStr).toBe('2026-01-31');
    expect(endDateStr).toBe('2026-02-28');
  });

  it("gives the same days as calculateDateRange for period 'custom'", () => {
    const now = new Date(2026, 8, 25, 21, 0, 0);
    const expected = calculateDateRange('custom', '2026-09-01', '2026-09-07', now);
    const { startDateStr, endDateStr } = scheduleOverviewDays('custom', '2026-09-01', '2026-09-07', now);
    expect(startDateStr).toBe(expected.startDateStr);
    expect(endDateStr).toBe(expected.endDateStr);
  });
});
