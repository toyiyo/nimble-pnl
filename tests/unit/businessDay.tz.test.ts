import { describe, it, expect } from 'vitest';
import {
  toBusinessDay,
  toBusinessDayFor,
  businessDayStartInstant,
  addDaysToDayToken,
  MAX_BUSINESS_DAY_START_HOUR,
} from '@/lib/businessDay';
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

  // A post-midnight clock-in under a cutoff rolls the business day BACKWARDS,
  // and a backwards roll off the 1st of a month has to resolve against the
  // real year's calendar. Every case below sits one hour after midnight
  // Chicago time, expressed as the corresponding UTC instant (CST = UTC-6,
  // CDT = UTC-5), with cutoff 2 -- so each must land on the last day of the
  // PREVIOUS month or year.
  it.each([
    // 2026 is not a leap year: February ends on the 28th.
    { name: 'March 1 in a non-leap year', instant: '2026-03-01T07:00:00.000Z', expected: '2026-02-28' },
    // 2024 is: the same roll must find the 29th.
    { name: 'March 1 in a leap year', instant: '2024-03-01T07:00:00.000Z', expected: '2024-02-29' },
    // 2100 is divisible by 4 but is NOT a leap year (the century rule).
    { name: 'March 1 in a non-leap century', instant: '2100-03-01T07:00:00.000Z', expected: '2100-02-28' },
    { name: 'January 1 (year rollback)', instant: '2026-01-01T07:00:00.000Z', expected: '2025-12-31' },
    { name: 'the 1st of a 30-day month', instant: '2026-05-01T06:00:00.000Z', expected: '2026-04-30' },
  ])('rolls back across a month boundary onto the right calendar: $name', ({ instant, expected }) => {
    expect(toBusinessDay(instant, TZ, 2)).toBe(expected);
  });

  /**
   * businessDayStartInstant is what lets the payroll fetch cover exactly the
   * business days its filter will select, in any pair of zones. That rests on
   * two properties:
   *
   *   1. It is toBusinessDay's left inverse at each day's lower edge -- the
   *      returned instant is in `day`, one millisecond earlier is not.
   *   2. Where 1 cannot hold it is still within ONE HOUR of the true edge, in
   *      either direction. A DST transition is what breaks 1, and it breaks it
   *      both ways: a spring-forward can skip the cutoff wall clock (02:00 in
   *      US zones) so no instant is the edge, and a fall-back can repeat it so
   *      two are, of which fromZonedTime returns the second. That one hour is
   *      exactly what DST_SLACK_HOURS in punchWindow pays for -- with
   *      OVERNIGHT_BUFFER_HOURS already equal to MAX_SHIFT_GAP_HOURS, an
   *      unbudgeted hour on either bound costs a real pairing.
   *
   * Hard-coded zones and days, deliberately including both DST transitions and
   * a zone (Kolkata) on a half-hour offset, where an implementation that
   * rounded to whole hours would land on the wrong side.
   */
  describe('businessDayStartInstant is the lower edge of the business day', () => {
    const HOUR_MS = 3_600_000;
    // Transition-free in every zone below, so property 1 holds exactly.
    const PLAIN_DAYS = ['2026-01-11', '2026-07-12', '2026-02-28', '2026-12-31'];
    const DST_DAYS = [
      '2026-03-08', // US spring-forward: 02:00 does not exist
      '2026-11-01', // US fall-back: 01:00 happens twice
      '2026-04-05', // NZ fall-back
      '2026-09-27', // NZ spring-forward
    ];
    for (const tz of ['America/Chicago', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Kolkata', 'UTC']) {
      for (let cutoffHour = 0; cutoffHour <= MAX_BUSINESS_DAY_START_HOUR; cutoffHour++) {
        it(`${tz} @ cutoff ${cutoffHour}`, () => {
          const cfg = { tz, cutoffHour };
          for (const day of [...PLAIN_DAYS, ...DST_DAYS]) {
            const at = `${tz}/${day}@${cutoffHour}`;
            const startsAt = businessDayStartInstant(day, cfg);

            // Property 2, for every day: an hour before is definitely outside
            // `day`, an hour after is definitely inside it.
            const before = toBusinessDayFor(new Date(startsAt.getTime() - HOUR_MS - 1), cfg);
            const after = toBusinessDayFor(new Date(startsAt.getTime() + HOUR_MS), cfg);
            expect(before, `${at}: an hour before the start is not before ${day}`)
              .toBe(addDaysToDayToken(day, -1));
            expect(after, `${at}: an hour after the start is not yet ${day}`).toBe(day);

            // Property 1, on the days where nothing perturbs the wall clock.
            if (PLAIN_DAYS.includes(day)) {
              expect(toBusinessDayFor(startsAt, cfg), at).toBe(day);
              expect(toBusinessDayFor(new Date(startsAt.getTime() - 1), cfg), at)
                .toBe(addDaysToDayToken(day, -1));
            }
          }
        });
      }
    }
  });

  it('addDaysToDayToken rolls months, years and leap days in token space', () => {
    expect(addDaysToDayToken('2026-07-12', 1)).toBe('2026-07-13');
    expect(addDaysToDayToken('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDaysToDayToken('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDayToken('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysToDayToken('2024-02-28', 1)).toBe('2024-02-29'); // leap year
    expect(addDaysToDayToken('2100-02-28', 1)).toBe('2100-03-01'); // century rule
    expect(addDaysToDayToken('2026-01-01', -1)).toBe('2025-12-31');
  });
});
