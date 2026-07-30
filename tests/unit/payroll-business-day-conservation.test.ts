import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCost,
  calculateHoursPerEmployee,
  calculateActualLaborCostForMonth,
} from '@/services/laborCalculations';
import { parseWorkPeriods } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

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
