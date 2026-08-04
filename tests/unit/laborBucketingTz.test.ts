import { describe, expect, it } from 'vitest';

import { calculateActualLaborCost } from '@/services/laborCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * The real incident (memory/lessons.md:1403): a clock-in at 2026-07-23T01:56:20Z
 * is Jul 22 20:56 in Chicago. Bucketed by the HOST calendar on a UTC runner it
 * lands on Jul 23 and the shift's cost moves to the wrong day.
 *
 * Asserts through the exported engine so the day bucketing is covered where it
 * actually happens.
 */
const RESTAURANT_TZ = 'America/Chicago';

const employee = {
  id: 'emp-1',
  restaurant_id: 'rest-1',
  status: 'active',
  compensation_type: 'hourly',
  hourly_rate: 20,
  first_name: 'Test',
  last_name: 'Employee',
} as unknown as Employee;

function punch(punch_type: TimePunch['punch_type'], punch_time: string): TimePunch {
  return {
    id: `${punch_type}-${punch_time}`,
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    punch_type,
    punch_time,
  } as TimePunch;
}

describe('calculateActualLaborCost buckets by the restaurant day', () => {
  // 19:00 -> 21:56 Chicago on Jul 22, i.e. entirely within Jul 22 local.
  const punches = [
    punch('clock_in', '2026-07-23T00:00:00Z'),
    punch('clock_out', '2026-07-23T02:56:20Z'),
  ];

  it('attributes the hours to the clock-in day in the restaurant zone', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [employee],
      punches,
      new Date(2026, 6, 20),
      new Date(2026, 6, 25),
      RESTAURANT_TZ,
    );

    const jul22 = dailyCosts.find((d) => d.date === '2026-07-22');
    const jul23 = dailyCosts.find((d) => d.date === '2026-07-23');

    expect(jul22?.hours_worked).toBeCloseTo(2.94, 1);
    expect(jul23?.hours_worked ?? 0).toBe(0);
  });

  it('produces the same bucketing whatever the host timezone is', () => {
    // The assertion above is host-independent by construction; test:tz runs this
    // file under Chicago, Auckland and UTC to prove it.
    //
    // NOTE: the brief's draft asserted `breakdown.total_hours`, but
    // `LaborCostBreakdown` has no such field (it's `total: number` — dollars,
    // plus per-bucket `hourly.hours`/`salary`/etc). `breakdown.hourly.hours`
    // is the correct total-hours read for this single hourly employee.
    const { breakdown } = calculateActualLaborCost(
      [employee],
      punches,
      new Date(2026, 6, 20),
      new Date(2026, 6, 25),
      RESTAURANT_TZ,
    );
    expect(breakdown.hourly.hours).toBeCloseTo(2.94, 1);
  });
});
