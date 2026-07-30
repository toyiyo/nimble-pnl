import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCost,
  calculateHoursPerEmployee,
  calculateActualLaborCostForMonth,
  calculateScheduledLaborCost,
} from '@/services/laborCalculations';
import { parseWorkPeriods, calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';
import type { OvertimeRules } from '@/lib/overtimeCalculations';

/**
 * THE structural guarantee against under/overpayment.
 *
 * Bucketing may move hours between business days. It may never create or
 * destroy an hour. If this test is ever relaxed, the feature is unsafe --
 * per the requirement "we can't be under/over paying people with this change".
 */

const TZ = 'America/Chicago';

function hourly(id: string, rateCents: number): Employee {
  return {
    id, restaurant_id: 'r1', name: id, status: 'active',
    compensation_type: 'hourly', hourly_rate: rateCents, is_exempt: false,
  } as Employee;
}

function dailyRate(id: string, rateCents: number): Employee {
  return {
    id, restaurant_id: 'r1', name: id, status: 'active',
    compensation_type: 'daily_rate', daily_rate_amount: rateCents, is_exempt: false,
  } as Employee;
}

function pair(employeeId: string, inIso: string, outIso: string): TimePunch[] {
  return [
    { id: `${employeeId}-in-${inIso}`, employee_id: employeeId, restaurant_id: 'r1',
      punch_type: 'clock_in', punch_time: inIso } as TimePunch,
    { id: `${employeeId}-out-${outIso}`, employee_id: employeeId, restaurant_id: 'r1',
      punch_type: 'clock_out', punch_time: outIso } as TimePunch,
  ];
}

// 18:00 -> 03:00 (overnight), 01:00 -> 07:00 (post-midnight), 10:00 -> 18:00.
const PUNCHES = [
  ...pair('e1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'),
  ...pair('e1', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'),
  ...pair('e1', '2026-07-31T15:00:00.000Z', '2026-07-31T23:00:00.000Z'),
];
const FROM = new Date('2026-07-26T00:00:00.000Z');
const TO = new Date('2026-08-02T23:59:59.999Z');

describe('conservation invariant: hours are never created or destroyed', () => {
  const expectedTotal = parseWorkPeriods(PUNCHES).periods
    .filter((p) => !p.isBreak)
    .reduce((sum, p) => sum + p.hours, 0);

  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  it.each(cutoffs)('cutoff %i conserves total hours', (cutoffHour) => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)], PUNCHES, FROM, TO, { tz: TZ, cutoffHour },
    );
    const bucketed = dailyCosts.reduce((sum, d) => sum + d.hours_worked, 0);
    expect(bucketed).toBeCloseTo(expectedTotal, 6);
  });
});

describe('conservation invariant: daily_rate charges N rates for N shifts', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);
  const DAILY_RATE_CENTS = 15000;
  const SHIFT_COUNT = 3;

  it.each(cutoffs)('cutoff %i charges exactly 3 daily rates', (cutoffHour) => {
    const { dailyCosts } = calculateActualLaborCost(
      [dailyRate('e4', DAILY_RATE_CENTS)],
      PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })),
      FROM, TO, { tz: TZ, cutoffHour },
    );
    const total = dailyCosts.reduce((sum, d) => sum + d.daily_rate_cost, 0);
    // Three shifts -> three daily rates. Never 2N (the overnight double-charge).
    expect(total).toBeCloseTo((DAILY_RATE_CENTS / 100) * SHIFT_COUNT, 2);
  });
});

describe('the reported symptom: an overnight shift lands on its clock-in day', () => {
  it('attributes a 6 PM -> 3 AM shift wholly to the clock-in business day', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)],
      pair('e1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'),
      FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    const jul28 = dailyCosts.find((d) => d.date === '2026-07-28');
    const jul29 = dailyCosts.find((d) => d.date === '2026-07-29');
    expect(jul28?.hours_worked).toBeCloseTo(9, 6);
    expect(jul29?.hours_worked ?? 0).toBe(0);
  });

  it('rolls a 1 AM clock-in back to the previous business day at cutoff 2', () => {
    const { dailyCosts } = calculateActualLaborCost(
      [hourly('e1', 2000)],
      pair('e1', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'),
      FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked).toBeCloseTo(6, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-30')?.hours_worked ?? 0).toBe(0);
  });
});

describe('calculateHoursPerEmployee agrees with calculateActualLaborCost', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  // NOTE: the plan's illustrative code names these fields `daysWorked` /
  // `totalHours`; EmployeeHoursSummary's real fields are snake_case
  // (`days_worked` / `total_hours`, per src/services/laborCalculations.ts:130-144
  // -- same naming convention already documented in Task 3/5's progress notes).
  it.each(cutoffs)('cutoff %i: days_worked counts shifts, not spanned days', (cutoffHour) => {
    const [summary] = calculateHoursPerEmployee(
      [dailyRate('e4', 15000)],
      PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })),
      FROM, TO, { tz: TZ, cutoffHour },
    );
    // Three shifts, one of them overnight. Three days worked, never four.
    expect(summary.days_worked).toBe(3);
  });

  it.each(cutoffs)('cutoff %i: total hours match parseWorkPeriods', (cutoffHour) => {
    const expected = parseWorkPeriods(PUNCHES).periods
      .filter((p) => !p.isBreak)
      .reduce((sum, p) => sum + p.hours, 0);
    const [summary] = calculateHoursPerEmployee(
      [hourly('e1', 2000)], PUNCHES, FROM, TO, { tz: TZ, cutoffHour },
    );
    expect(summary.total_hours).toBeCloseTo(expected, 6);
  });
});

describe('calculateActualLaborCostForMonth conserves wages across cutoffs', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);

  it.each(cutoffs)('cutoff %i yields the same monthly wage total', (cutoffHour) => {
    const { actualLaborCents } = calculateActualLaborCostForMonth({
      employees: [hourly('e1', 2000)],
      timePunches: PUNCHES,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T23:59:59.999Z'),
      businessDay: { tz: TZ, cutoffHour },
    });
    // All three shifts clock in within July in America/Chicago at every cutoff
    // in 0..11, so the monthly total is cutoff-invariant. 23h at $20/h.
    expect(actualLaborCents).toBe(46000);
  });
});

describe('calculateActualLaborCostForMonth: cutoff actually moves a shift across the MONTH boundary', () => {
  // The describe block above is deliberately cutoff-invariant (no shift crosses
  // a month boundary in ANY of the 0..11 cutoffs), so passing an unused
  // `businessDay` field there would satisfy it by accident -- it can't tell
  // "cutoff is applied" from "cutoff is silently ignored". This is the test
  // that can: a 01:00 CDT Aug-1 clock-in that a >=2 cutoff rolls back onto
  // Jul 31, which changes which MONTH the shift's wages land in.
  const AUG1_0100_CDT = pair('e5', '2026-08-01T06:00:00.000Z', '2026-08-01T12:00:00.000Z'); // 6h

  it('at cutoff 0 the shift is Aug 1 local calendar day -- excluded from the July window', () => {
    const { actualLaborCents } = calculateActualLaborCostForMonth({
      employees: [hourly('e5', 2000)],
      timePunches: AUG1_0100_CDT,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T23:59:59.999Z'),
      businessDay: { tz: TZ, cutoffHour: 0 },
    });
    expect(actualLaborCents).toBe(0);
  });

  it('at cutoff 2 the 01:00 clock-in rolls back to Jul 31 -- included in the July window', () => {
    const { actualLaborCents } = calculateActualLaborCostForMonth({
      employees: [hourly('e5', 2000)],
      timePunches: AUG1_0100_CDT,
      tipsOwedByEmployee: new Map(),
      monthStart: new Date('2026-07-01T00:00:00.000Z'),
      monthEnd: new Date('2026-07-31T23:59:59.999Z'),
      businessDay: { tz: TZ, cutoffHour: 2 },
    });
    // 6h * $20/h = 12,000 cents. A cutoffHour that is silently ignored (the
    // pre-fix behavior) would bucket by the host's local calendar day
    // regardless of cutoffHour and report 0 here too.
    expect(actualLaborCents).toBe(12000);
  });
});

describe('scheduled and actual bucket identically', () => {
  // The Scheduling page shows scheduled-vs-actual variance. If actual buckets by
  // business day and scheduled by calendar day, the two sides use different
  // framings and every overnight shift shows a phantom variance.
  function shift(id: string, startIso: string, endIso: string) {
    return {
      id, restaurant_id: 'r1', employee_id: 'e1',
      start_time: startIso, end_time: endIso,
      break_duration: 0, status: 'scheduled',
    } as unknown as Parameters<typeof calculateScheduledLaborCost>[0][number];
  }

  it('an overnight scheduled shift lands entirely on its start business day', () => {
    // 18:00 CDT Jul 28 -> 03:00 CDT Jul 29, 9h.
    const { dailyCosts } = calculateScheduledLaborCost(
      [shift('s1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z')],
      [hourly('e1', 2000)], FROM, TO, { tz: TZ, cutoffHour: 2 },
    );
    expect(dailyCosts.find((d) => d.date === '2026-07-28')?.hours_worked).toBeCloseTo(9, 6);
    expect(dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked ?? 0).toBe(0);
  });

  it('a 1 AM scheduled start rolls back onto the prior business day at cutoff 2', () => {
    // 01:00 CDT Jul 30. At cutoff 0 this is Jul 30; at cutoff 2 it is Jul 29.
    const shifts = [shift('s2', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z')];
    const employees = [hourly('e1', 2000)];

    const atZero = calculateScheduledLaborCost(shifts, employees, FROM, TO, { tz: TZ, cutoffHour: 0 });
    expect(atZero.dailyCosts.find((d) => d.date === '2026-07-30')?.hours_worked).toBeCloseTo(6, 6);

    const atTwo = calculateScheduledLaborCost(shifts, employees, FROM, TO, { tz: TZ, cutoffHour: 2 });
    expect(atTwo.dailyCosts.find((d) => d.date === '2026-07-29')?.hours_worked).toBeCloseTo(6, 6);
    expect(atTwo.dailyCosts.find((d) => d.date === '2026-07-30')?.hours_worked ?? 0).toBe(0);
  });

  it('scheduled hours per business day match actual hours for the same shifts', () => {
    // The variance guarantee, stated directly: schedule exactly what was worked
    // and every day's variance must be zero, at every cutoff.
    const shifts = [
      shift('s1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z'),
      shift('s2', '2026-07-30T06:00:00.000Z', '2026-07-30T12:00:00.000Z'),
      shift('s3', '2026-07-31T15:00:00.000Z', '2026-07-31T23:00:00.000Z'),
    ];
    const employees = [hourly('e1', 2000)];

    for (let cutoffHour = 0; cutoffHour <= 11; cutoffHour++) {
      const { dailyCosts } = calculateScheduledLaborCost(
        shifts, employees, FROM, TO, { tz: TZ, cutoffHour },
      );
      const actual = calculateActualLaborCost(
        employees, PUNCHES, FROM, TO, { tz: TZ, cutoffHour },
      );

      for (const day of dailyCosts) {
        const actualDay = actual.dailyCosts.find((d) => d.date === day.date);
        expect(
          day.hours_worked,
          `cutoff ${cutoffHour}, ${day.date}: scheduled and actual disagree`,
        ).toBeCloseTo(actualDay?.hours_worked ?? 0, 6);
      }
    }
  });
});

/**
 * The PAYROLL path (task 10). Everything above buckets labor COST for the
 * dashboard; these pin what an employee is actually PAID.
 */
describe('payroll: daily_rate charges one rate per shift', () => {
  const cutoffs = Array.from({ length: 12 }, (_, h) => h);
  const DAILY_RATE_CENTS = 15000;

  // Local-component calendar-day tokens: production bounds come from
  // usePeriodNavigation's startOfWeek(), which is local midnight.
  const PERIOD_START = new Date(2026, 6, 26);
  const PERIOD_END = new Date(2026, 7, 1, 23, 59, 59, 999);

  it.each(cutoffs)(
    'cutoff %i pays 3 daily rates for 3 shifts, never 6 for the days they span',
    (cutoffHour) => {
      const result = calculateEmployeePay(
        dailyRate('e4', DAILY_RATE_CENTS),
        PUNCHES.map((p) => ({ ...p, employee_id: 'e4' })),
        0, PERIOD_START, PERIOD_END, [], 0, undefined, [], true,
        { tz: TZ, cutoffHour },
      );
      expect(result.daysWorked).toBe(3);
      expect(result.dailyRatePay).toBe(3 * DAILY_RATE_CENTS);
    },
  );

  it('counts the FIRST day of the pay period -- regression, it used to be dropped', () => {
    // Jul 27 10:00 CDT, on the period's opening day. The old branch compared
    // `new Date('2026-07-27')` (UTC midnight) against a local-midnight bound;
    // west of Greenwich UTC midnight sorts EARLIER, so the day fell outside the
    // window and the employee was underpaid one full daily rate every period.
    const result = calculateEmployeePay(
      dailyRate('e4', 15000),
      pair('e4', '2026-07-27T15:00:00.000Z', '2026-07-27T23:00:00.000Z'),
      0, new Date(2026, 6, 27), new Date(2026, 7, 1, 23, 59, 59, 999),
      [], 0, undefined, [], true,
      { tz: TZ, cutoffHour: 0 },
    );
    expect(result.daysWorked).toBe(1);
    expect(result.dailyRatePay).toBe(15000);
  });

  it('rolls a 1 AM start onto the prior business day at cutoff 2', () => {
    // 01:00 CDT Jul 29 -> Jul 28, plus a 10:00 CDT Jul 28 shift -> Jul 28.
    // Two shifts, ONE business day, so one daily rate.
    const punches = [
      ...pair('e4', '2026-07-28T15:00:00.000Z', '2026-07-28T23:00:00.000Z'),
      ...pair('e4', '2026-07-29T06:00:00.000Z', '2026-07-29T12:00:00.000Z'),
    ];
    const args = [
      0, new Date(2026, 6, 26), new Date(2026, 7, 1, 23, 59, 59, 999),
      [], 0, undefined, [], true,
    ] as const;

    const atCutoff2 = calculateEmployeePay(
      dailyRate('e4', 15000), punches, ...args, { tz: TZ, cutoffHour: 2 },
    );
    expect(atCutoff2.daysWorked).toBe(1);

    // At cutoff 0 the same two shifts are two calendar days -- proving the
    // cutoff, not the pairing, is what merged them.
    const atCutoff0 = calculateEmployeePay(
      dailyRate('e4', 15000), punches, ...args, { tz: TZ, cutoffHour: 0 },
    );
    expect(atCutoff0.daysWorked).toBe(2);
  });

  it('still pays a day when the clock-out is missing -- never underpay', () => {
    const orphan = [
      { id: 'o-in', employee_id: 'e4', restaurant_id: 'r1',
        punch_type: 'clock_in', punch_time: '2026-07-28T23:00:00.000Z' } as TimePunch,
    ];
    const result = calculateEmployeePay(
      dailyRate('e4', 15000), orphan,
      0, new Date(2026, 6, 26), new Date(2026, 7, 1, 23, 59, 59, 999),
      [], 0, undefined, [], true,
      { tz: TZ, cutoffHour: 2 },
    );
    expect(result.daysWorked).toBe(1);
    expect(result.dailyRatePay).toBe(15000);
  });
});

describe('payroll: hourly OT bands by business day', () => {
  const OT_RULES: OvertimeRules = {
    weeklyThresholdHours: 40,
    weeklyOtMultiplier: 1.5,
    dailyThresholdHours: 8,
    dailyOtMultiplier: 1.5,
    dailyDoubleThresholdHours: 12,
    dailyDoubleMultiplier: 2,
    excludeTipsFromOtRate: false,
  };

  const PERIOD_START = new Date(2026, 6, 26);
  const PERIOD_END = new Date(2026, 7, 1, 23, 59, 59, 999);

  // ONE 9-hour overnight shift: 18:00 CDT Jul 28 -> 03:00 CDT Jul 29.
  const OVERNIGHT = pair('e1', '2026-07-28T23:00:00.000Z', '2026-07-29T08:00:00.000Z');

  it('keeps a 9h overnight shift whole, so it crosses the 8h daily OT threshold', () => {
    const result = calculateEmployeePay(
      hourly('e1', 2000), OVERNIGHT,
      0, PERIOD_START, PERIOD_END, [], 0, OT_RULES, [], true,
      { tz: TZ, cutoffHour: 2 },
    );
    // 9h on one business day = 8 regular + 1 daily OT. Split 6h/3h across two
    // days it would be 9 regular and 0 OT -- underpaying an hour of premium.
    expect(result.regularHours).toBeCloseTo(8, 6);
    expect(result.dailyOvertimeHours).toBeCloseTo(1, 6);
    expect(result.regularHours + result.overtimeHours).toBeCloseTo(9, 6);
  });

  it('the CUTOFF, not the pairing, decides whether two shifts share an OT day', () => {
    // 10:00-18:00 CDT Jul 28 (8h) and 01:00-04:00 CDT Jul 29 (3h). Two separate
    // shifts, so whole-shift attribution alone cannot merge them -- only the
    // cutoff can. This is the discriminating case: an overnight shift already
    // lands on its clock-in day at cutoff 0, so it proves nothing about cutoffs.
    const punches = [
      ...pair('e1', '2026-07-28T15:00:00.000Z', '2026-07-28T23:00:00.000Z'),
      ...pair('e1', '2026-07-29T06:00:00.000Z', '2026-07-29T09:00:00.000Z'),
    ];
    const call = (cutoffHour: number) =>
      calculateEmployeePay(
        hourly('e1', 2000), punches,
        0, PERIOD_START, PERIOD_END, [], 0, OT_RULES, [], true,
        { tz: TZ, cutoffHour },
      );

    // Cutoff 0: 8h on Jul 28 and 3h on Jul 29, neither over the 8h threshold.
    const atZero = call(0);
    expect(atZero.dailyOvertimeHours).toBeCloseTo(0, 6);
    expect(atZero.regularHours).toBeCloseTo(11, 6);

    // Cutoff 2: the 01:00 start rolls back onto Jul 28, making it an 11h
    // business day -- 8 regular + 3 at the daily OT premium.
    const atTwo = call(2);
    expect(atTwo.dailyOvertimeHours).toBeCloseTo(3, 6);
    expect(atTwo.regularHours).toBeCloseTo(8, 6);

    // Real money, not just a relabelling: those 3h move to the 1.5x rate.
    expect(atTwo.overtimePay - atZero.overtimePay).toBe(3 * 2000 * 1.5);
    expect(atTwo.grossPay).toBeGreaterThan(atZero.grossPay);
  });

  it('conserves total hours across every cutoff', () => {
    const expected = parseWorkPeriods(OVERNIGHT).periods
      .filter((p) => !p.isBreak)
      .reduce((sum, p) => sum + p.hours, 0);

    for (let cutoffHour = 0; cutoffHour <= 11; cutoffHour++) {
      const result = calculateEmployeePay(
        hourly('e1', 2000), OVERNIGHT,
        0, PERIOD_START, PERIOD_END, [], 0, OT_RULES, [], true,
        { tz: TZ, cutoffHour },
      );
      expect(
        result.regularHours + result.overtimeHours,
        `cutoff ${cutoffHour} lost or invented hours`,
      ).toBeCloseTo(expected, 6);
    }
  });
});
