import { describe, it, expect } from 'vitest';
import { groupShiftsByRestaurantDay, scheduleOverviewDays, scheduledCostInputs } from '../../supabase/functions/_shared/scheduleOverview';
import { calculateDateRange, toLocalYMD } from '../../supabase/functions/_shared/restaurantDate';
import { calculateScheduledLaborCost } from '../../supabase/functions/_shared/laborCalculations';

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

describe('scheduledCostInputs', () => {
  // A Chicago week: 2026-09-25 (Fri) .. 2026-10-02 (Fri), 8 restaurant days.
  const salaryEmployee = {
    id: 'sal-1',
    name: 'Sal',
    position: 'Manager',
    status: 'active',
    hire_date: '2024-01-01',
    compensation_type: 'salary',
    salary_amount: 70000, // $700/week in cents = $100/day
    pay_period_type: 'weekly',
  };
  const hourlyEmployee = {
    id: 'hr-1',
    name: 'Ana',
    position: 'Server',
    status: 'active',
    hire_date: '2024-01-01',
    compensation_type: 'hourly',
    hourly_rate: 1500, // $15/hr in cents
  };

  it('gives start and end Dates whose local fields are the restaurant days', () => {
    const { startDate, endDate } = scheduledCostInputs([], '2026-09-25', '2026-10-02', 'America/Chicago');
    expect(toLocalYMD(startDate)).toBe('2026-09-25');
    expect(toLocalYMD(endDate)).toBe('2026-10-02');
  });

  it('moves each shift start to the restaurant wall clock and keeps its length', () => {
    const { shiftData } = scheduledCostInputs(
      [{ employee_id: 'hr-1', start_time: '2026-10-03T02:00:00Z', end_time: '2026-10-03T06:30:00Z', break_duration: 30 }],
      '2026-09-25',
      '2026-10-02',
      'America/Chicago'
    );
    const start = new Date(shiftData[0].start_time);
    const end = new Date(shiftData[0].end_time);
    // Fri 2026-10-02 21:00 CDT
    expect(toLocalYMD(start)).toBe('2026-10-02');
    expect(start.getHours()).toBe(21);
    expect(end.getTime() - start.getTime()).toBe(4.5 * 3_600_000);
    expect(shiftData[0].break_duration).toBe(30);
    expect(shiftData[0].employee_id).toBe('hr-1');
  });

  it('keeps the cost engine on exactly the restaurant days', () => {
    const { shiftData, startDate, endDate } = scheduledCostInputs(
      [{ employee_id: 'hr-1', start_time: '2026-10-03T02:00:00Z', end_time: '2026-10-03T06:00:00Z', break_duration: 0 }],
      '2026-09-25',
      '2026-10-02',
      'America/Chicago'
    );
    const { dailyCosts, breakdown } = calculateScheduledLaborCost(
      shiftData,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [salaryEmployee, hourlyEmployee] as any,
      startDate,
      endDate
    );
    expect(dailyCosts.map((d) => d.date)).toEqual([
      '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28',
      '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
    // The Friday-night shift on the last day counts: 4 h x $15.
    expect(breakdown.hourly.hours).toBeCloseTo(4, 6);
    expect(breakdown.hourly.cost).toBeCloseTo(60, 6);
    expect(breakdown.salary.daysScheduled).toBe(8);
  });
});
