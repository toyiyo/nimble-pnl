import { describe, it, expect } from 'vitest';
import { toBusinessDay } from '@/lib/businessDay';
import { calculateActualLaborCost } from '@/services/laborCalculations';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import { hoursByClockInDay } from '@/utils/timecardHours';
import { SQL_PARITY_FIXTURES } from './fixtures/businessDayFixtures';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * FRAME INDEPENDENCE.
 *
 * A business day belongs to the RESTAURANT's zone. The process zone -- the
 * browser in production, the runner in CI -- must not be able to change a
 * single answer. This file states hard expectations and is run under several
 * TZ values by the `test:tz` script; a leak shows up as the same file passing
 * in one zone and failing in another.
 *
 * CI's default is UTC, the one zone where a browser-local read is invisible
 * (host == restaurant == UTC makes every wrong frame look right). Pacific/
 * Auckland is the sign-flip case: it is ahead of UTC, so an error that merely
 * shifts a US-zone answer by an hour flips it by a whole day there.
 *
 * Every expectation below is HARD-CODED, never a comparison of one run against
 * another. Two runs agreeing on a wrong answer is exactly what a
 * self-comparison cannot see.
 */

const TZ = 'America/Chicago';
const RATE_CENTS = 2000;

const EMPLOYEE = {
  id: 'e1',
  restaurant_id: 'r1',
  name: 'Overnight Server',
  status: 'active',
  compensation_type: 'hourly',
  hourly_rate: RATE_CENTS,
  is_exempt: false,
} as Employee;

// 18:00 CDT Jul 28 -> 03:00 CDT Jul 29. Nine hours, one shift, crossing both
// midnight and a cutoff-2 boundary.
const PUNCHES = [
  {
    id: 'a', employee_id: 'e1', restaurant_id: 'r1',
    punch_type: 'clock_in', punch_time: '2026-07-28T23:00:00.000Z',
  },
  {
    id: 'b', employee_id: 'e1', restaurant_id: 'r1',
    punch_type: 'clock_out', punch_time: '2026-07-29T08:00:00.000Z',
  },
] as TimePunch[];

// Local-component calendar-day tokens: the same framing the production callers
// use (usePeriodNavigation's startOfWeek, eachDayOfInterval). `new Date('...')`
// would be UTC midnight and would itself be process-zone dependent.
const FROM = new Date(2026, 6, 26);
const TO = new Date(2026, 7, 2, 23, 59, 59, 999);
const DAYS = Array.from({ length: 8 }, (_, i) => new Date(2026, 6, 26 + i));

const PROCESS_TZ = process.env.TZ ?? 'unset';

describe(`frame independence (process TZ = ${PROCESS_TZ})`, () => {
  it.each(SQL_PARITY_FIXTURES)(
    'toBusinessDay is process-zone independent: $name',
    ({ instant, tz, cutoffHour, expected }) => {
      expect(toBusinessDay(instant, tz, cutoffHour)).toBe(expected);
    },
  );

  it('labor cost bucketing is process-zone independent', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [EMPLOYEE], PUNCHES, FROM, TO, { tz: TZ, cutoffHour: 2 },
    );

    expect(dailyCosts.find((d) => d.date === '2026-07-28')?.hours_worked).toBeCloseTo(9, 6);
    // The whole point: nothing spills onto the clock-out day.
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked ?? 0).toBe(0);
  });

  it('timecard bucketing is process-zone independent', () => {
    const byDay = hoursByClockInDay(PUNCHES, DAYS, { tz: TZ, cutoffHour: 2 });

    expect(byDay.get('2026-07-28')?.netHours).toBeCloseTo(9, 6);
    expect(byDay.get('2026-07-29')?.netHours ?? 0).toBe(0);
  });

  it('paid hours and gross pay are process-zone independent', () => {
    // The number on the paycheck, not just the number on a report. If the
    // process zone could move a shift out of the pay window, this is where an
    // employee gets underpaid.
    const pay = calculateEmployeePay(
      EMPLOYEE, PUNCHES, 0, FROM, TO, [], 0, undefined, [], true,
      { tz: TZ, cutoffHour: 2 },
    );

    expect(pay.regularHours + pay.overtimeHours).toBeCloseTo(9, 6);
    expect(pay.grossPay).toBeCloseTo(9 * RATE_CENTS, 6);
  });

  it('a cutoff of 0 still means the RESTAURANT calendar day, not the process one', () => {
    // The discriminating case for a host-frame leak, and the reason a UTC-only
    // run proves nothing. Attribution is by clock-in, so cutoff 0 still lands
    // the whole shift on Jul 28 -- but only when the day is read in Chicago.
    // The clock-in instant is 08:00 Jul 29 in Tokyo and 11:00 Jul 29 in
    // Auckland, so any residual process-zone read moves all nine hours to the
    // wrong day in those zones while looking correct under UTC.
    const { dailyCosts } = calculateActualLaborCost(
      [EMPLOYEE], PUNCHES, FROM, TO, { tz: TZ, cutoffHour: 0 },
    );

    expect(dailyCosts.find((d) => d.date === '2026-07-28')?.hours_worked).toBeCloseTo(9, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked ?? 0).toBe(0);
  });
});
