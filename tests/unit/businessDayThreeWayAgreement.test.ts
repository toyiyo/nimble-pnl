import { describe, it, expect } from 'vitest';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import { hoursByClockInDay } from '@/utils/timecardHours';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * THREE-WAY AGREEMENT.
 *
 * The same shifts are rendered by three independent code paths:
 *
 *   Dashboard  calculateActualLaborCost   (services/laborCalculations)
 *   Payroll    calculateEmployeePay       (utils/payrollCalculations)
 *   Timecard   hoursByClockInDay          (utils/timecardHours)
 *
 * They share no bucketing code -- each pairs punches and assigns days on its
 * own. Before this feature they also disagreed, which is how an overnight
 * shift could show 9 hours on the timecard, 6 on the dashboard's Tuesday row,
 * and band OT as two short days on the payroll run.
 *
 * Agreement is the user-visible contract: an employee who compares their
 * timecard to their paycheck must find the same number. This file is the test
 * that fails if any one of the three drifts.
 */

const TZ = 'America/Chicago';
const RATE_CENTS = 2000;

function hourly(id: string): Employee {
  return {
    id, restaurant_id: 'r1', name: id, status: 'active',
    compensation_type: 'hourly', hourly_rate: RATE_CENTS, is_exempt: false,
  } as Employee;
}

function pair(inIso: string, outIso: string): TimePunch[] {
  return [
    { id: `in-${inIso}`, employee_id: 'e1', restaurant_id: 'r1',
      punch_type: 'clock_in', punch_time: inIso } as TimePunch,
    { id: `out-${outIso}`, employee_id: 'e1', restaurant_id: 'r1',
      punch_type: 'clock_out', punch_time: outIso } as TimePunch,
  ];
}

// Every shape that has historically split across a day boundary:
//   18:00 -> 03:00 overnight, 01:00 -> 07:00 post-midnight, 10:00 -> 18:00 plain.
const PUNCHES = [
  ...pair('2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'), // 9h
  ...pair('2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'), // 6h
  ...pair('2026-07-31T15:00:00.000Z', '2026-07-31T23:00:00.000Z'), // 8h
];
const TOTAL_HOURS = 23;

// Calendar-day tokens built from local components. A window wide enough that
// no cutoff in [0, 11] can push a shift off either edge -- otherwise a
// disagreement at the boundary would masquerade as a disagreement in framing.
const DAYS = Array.from({ length: 8 }, (_, i) => new Date(2026, 6, 26 + i));
const FROM = DAYS[0];
const TO = new Date(2026, 7, 2, 23, 59, 59, 999);

const CUTOFFS = Array.from({ length: 12 }, (_, h) => h);

describe('dashboard, payroll, and timecard agree on every business day', () => {
  it.each(CUTOFFS)('cutoff %i: per-day hours are identical in all three', (cutoffHour) => {
    const frame = { tz: TZ, cutoffHour };

    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1')], PUNCHES, FROM, TO, frame,
    );
    const dashboard = new Map(dailyCosts.map((d) => [d.date, d.hours_worked]));

    const timecard = hoursByClockInDay(PUNCHES, DAYS, frame);

    // Payroll exposes no per-day breakdown, so compare the total it bands --
    // the number that becomes the paycheck.
    const pay = calculateEmployeePay(
      hourly('e1'), PUNCHES, 0, FROM, TO, [], 0, undefined, [], true, frame,
    );

    for (const day of DAYS) {
      const key = [
        day.getFullYear(),
        String(day.getMonth() + 1).padStart(2, '0'),
        String(day.getDate()).padStart(2, '0'),
      ].join('-');
      expect(
        dashboard.get(key) ?? 0,
        `${key}: dashboard and timecard disagree at cutoff ${cutoffHour}`,
      ).toBeCloseTo(timecard.get(key)?.netHours ?? 0, 6);
    }

    const dashboardTotal = dailyCosts.reduce((sum, d) => sum + d.hours_worked, 0);
    const timecardTotal = [...timecard.values()].reduce((sum, d) => sum + d.netHours, 0);
    const payrollTotal = pay.regularHours + pay.overtimeHours;

    expect(dashboardTotal).toBeCloseTo(TOTAL_HOURS, 6);
    expect(timecardTotal).toBeCloseTo(TOTAL_HOURS, 6);
    expect(payrollTotal).toBeCloseTo(TOTAL_HOURS, 6);
  });

  it.each(CUTOFFS)('cutoff %i: gross pay equals hours x rate', (cutoffHour) => {
    // No OT rules, so every hour is straight time. This is the arithmetic that
    // says the employee is paid for exactly what the other two views display --
    // bucketing may move an hour between days, never onto or off the paycheck.
    const pay = calculateEmployeePay(
      hourly('e1'), PUNCHES, 0, FROM, TO, [], 0, undefined, [], true,
      { tz: TZ, cutoffHour },
    );
    expect(pay.grossPay).toBeCloseTo(TOTAL_HOURS * RATE_CENTS, 6);
  });
});
