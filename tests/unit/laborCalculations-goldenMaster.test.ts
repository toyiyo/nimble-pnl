import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCost,
  calculateHoursPerEmployee,
} from '@/services/laborCalculations';
import { calculateEmployeePay } from '@/utils/payrollCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

/**
 * GOLDEN MASTER -- captured before the business-day cutoff change.
 *
 * These snapshots pin the CURRENT output of the labor and payroll calculators.
 * After the cutoff work lands, every one of them must still match when the
 * restaurant zone equals the process zone and cutoff is 0 -- that isolates the
 * cutoff change from the frame repair.
 *
 * A snapshot that legitimately changes gets an entry in ALLOWED_DIFFS below,
 * with a hand-computed expected value and a one-line reason. A golden master
 * with a long allowlist is not a golden master -- if this list grows past a
 * handful of entries, stop and re-read design section 3.
 */

const RESTAURANT_TZ = 'America/Chicago';

function hourly(id: string, rateCents: number): Employee {
  return {
    id,
    restaurant_id: 'r1',
    name: `Employee ${id}`,
    status: 'active',
    compensation_type: 'hourly',
    hourly_rate: rateCents,
    is_exempt: false,
  } as Employee;
}

function dailyRate(id: string, rateCents: number): Employee {
  return {
    id,
    restaurant_id: 'r1',
    name: `Employee ${id}`,
    status: 'active',
    compensation_type: 'daily_rate',
    daily_rate_amount: rateCents,
    is_exempt: false,
  } as Employee;
}

function punch(employeeId: string, type: string, iso: string): TimePunch {
  return {
    id: `${employeeId}-${type}-${iso}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: iso,
  } as TimePunch;
}

// A 6 PM -> 3 AM overnight shift (the reported symptom), a same-day shift, and
// a 1 AM -> 7 AM shift that a 2 AM cutoff will reassign.
const OVERNIGHT = [
  punch('e1', 'clock_in', '2026-07-28T23:00:00.000Z'),  // 18:00 CDT Jul 28
  punch('e1', 'clock_out', '2026-07-29T08:00:00.000Z'), // 03:00 CDT Jul 29
];
const SAME_DAY = [
  punch('e2', 'clock_in', '2026-07-29T15:00:00.000Z'),  // 10:00 CDT
  punch('e2', 'clock_out', '2026-07-29T23:00:00.000Z'), // 18:00 CDT
];
const POST_MIDNIGHT = [
  punch('e3', 'clock_in', '2026-07-29T06:00:00.000Z'),  // 01:00 CDT Jul 29
  punch('e3', 'clock_out', '2026-07-29T12:00:00.000Z'), // 07:00 CDT Jul 29
];
const DAILY_RATE_OVERNIGHT = [
  punch('e4', 'clock_in', '2026-07-28T23:00:00.000Z'),
  punch('e4', 'clock_out', '2026-07-29T08:00:00.000Z'),
];

const EMPLOYEES = [
  hourly('e1', 2000),
  hourly('e2', 2500),
  hourly('e3', 1800),
  dailyRate('e4', 15000),
];
const ALL_PUNCHES = [...OVERNIGHT, ...SAME_DAY, ...POST_MIDNIGHT, ...DAILY_RATE_OVERNIGHT];

// Period bounds are CALENDAR-DAY TOKENS, not instants: generateDateRange() and
// the payroll window read their LOCAL fields. Parsing '...T00:00:00.000Z' here
// would seed Jul 26 west of Greenwich and Jul 27 on a UTC runner, so the
// snapshot would encode the runner's zone -- a golden master that moves with
// the machine pins nothing. Local components give the same token everywhere.
const FROM = new Date(2026, 6, 27);
const TO = new Date(2026, 6, 31, 23, 59, 59, 999);

describe('golden master: calculateActualLaborCost', () => {
  it('matches the pre-change snapshot', () => {
    const result = calculateActualLaborCost(
      EMPLOYEES, ALL_PUNCHES, FROM, TO, { tz: RESTAURANT_TZ, cutoffHour: 0 },
    );
    expect(result).toMatchSnapshot();
  });
});

describe('golden master: calculateHoursPerEmployee', () => {
  it('matches the pre-change snapshot', () => {
    const result = calculateHoursPerEmployee(
      EMPLOYEES, ALL_PUNCHES, FROM, TO, { tz: RESTAURANT_TZ, cutoffHour: 0 },
    );
    expect(result).toMatchSnapshot();
  });
});

describe('golden master: calculateEmployeePay', () => {
  it.each([
    ['hourly overnight', hourly('e1', 2000), OVERNIGHT],
    ['hourly same-day', hourly('e2', 2500), SAME_DAY],
    ['hourly post-midnight', hourly('e3', 1800), POST_MIDNIGHT],
    ['daily_rate overnight', dailyRate('e4', 15000), DAILY_RATE_OVERNIGHT],
  ])('matches the pre-change snapshot: %s', (_label, employee, punches) => {
    const result = calculateEmployeePay(employee, punches, 0, FROM, TO, [], 0, undefined, [], true);
    expect(result).toMatchSnapshot();
  });
});

/**
 * Deliberately-changed cases. EMPTY at capture time; each later task that
 * legitimately moves a number adds one entry here with a hand-computed value.
 */
export const ALLOWED_DIFFS: Array<{ snapshot: string; reason: string; expected: string }> = [
  {
    snapshot: 'golden master: calculateActualLaborCost > matches the pre-change snapshot',
    reason:
      'daily_rate employee e4 worked ONE overnight shift (18:00 Jul 28 -> 03:00 Jul 29). ' +
      'The old day-spanning loop charged a full daily rate on both Jul 28 and Jul 29. ' +
      'Design section 3.3.',
    expected: 'daily_rate_cost totals $150.00 across the range, not $300.00',
  },
  {
    snapshot: 'golden master: calculateHoursPerEmployee > matches the pre-change snapshot',
    reason:
      'Same fix, rerouted the same way (task 6): both e1 (hourly) and e4 ' +
      '(daily_rate) worked ONE overnight shift each, so activeDays -- previously ' +
      'every calendar day the period touched -- now holds exactly the clock-in ' +
      'business day. days_worked drops from 2 to 1 for both. Only e4 (daily_rate) ' +
      'also loses a cost charge: total_cost_cents 30000 -> 15000, since e1 (hourly) ' +
      'is costed via hours_per_day, which was already keyed by the start day and ' +
      'is unaffected. Design section 3.3.',
    expected:
      'e1 row: days_worked 1 (cost unchanged). ' +
      'e4 row: days_worked 1, total_cost_cents 15000 (not 2 / 30000)',
  },
];

describe('golden master allowlist', () => {
  it('stays short -- a long allowlist means the change is not understood', () => {
    expect(ALLOWED_DIFFS.length).toBeLessThanOrEqual(6);
  });
});
