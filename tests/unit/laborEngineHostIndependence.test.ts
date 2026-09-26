import { describe, expect, it } from 'vitest';

import { calculateActualLaborCostForRange } from '@/services/laborCalculations';
import {
  calculateEmployeePay,
  parseWorkPeriods,
  shouldIncludeEmployeeInPayroll,
} from '@/utils/payrollCalculations';
import { weekAlignedFetchEnd, weekAlignedFetchStart } from '@/utils/punchWindow';
import { getPayPeriodDates, resolveCompensationForDate } from '@/utils/compensationCalculations';
import { parseDateOnly } from '@/lib/dateOnly';
import type { LaborEmployee, LaborTimePunch } from '../../supabase/functions/_shared/labor/types';

/**
 * The engine must give the same result on every host timezone. The edge
 * runtime is UTC, a viewer can be anywhere, and the restaurant has its own
 * zone. Run this file under `npm run test:tz` (Chicago, Auckland, UTC).
 *
 * All instants are fixed UTC strings. Day tokens (engine period arguments) are
 * built with local-field constructors, so their calendar day is the same on
 * every host.
 */
const CHI = 'America/Chicago';
const AKL = 'Pacific/Auckland';

function employee(overrides: Partial<LaborEmployee> = {}): LaborEmployee {
  return {
    id: 'emp-1',
    restaurant_id: 'rest-1',
    name: 'Test Employee',
    position: 'Server',
    status: 'active',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 2000,
    ...overrides,
  };
}

function punch(punch_type: LaborTimePunch['punch_type'], punch_time: string): LaborTimePunch {
  return {
    id: `${punch_type}-${punch_time}`,
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    punch_type,
    punch_time,
  } as LaborTimePunch;
}

// Chicago week Mon 2026-07-13 .. Sun 2026-07-19 (CDT, UTC-5).
// Mon-Fri 09:00-17:00 CDT = 40 h. Then Sun 2026-07-19 20:00-22:00 CDT = 2 h,
// which is Mon 2026-07-20 01:00Z-03:00Z in UTC.
const weekdayShifts = ['13', '14', '15', '16', '17'].flatMap((d) => [
  punch('clock_in', `2026-07-${d}T14:00:00Z`),
  punch('clock_out', `2026-07-${d}T22:00:00Z`),
]);
const sundayEveningShift = [
  punch('clock_in', '2026-07-20T01:00:00Z'),
  punch('clock_out', '2026-07-20T03:00:00Z'),
];

describe('calculateActualLaborCostForRange: OT week of a punch', () => {
  it('puts a Sunday 20:00 CDT clock-in in the Chicago OT week', () => {
    const { wagesCents } = calculateActualLaborCostForRange({
      employees: [employee()],
      timePunches: [...weekdayShifts, ...sundayEveningShift],
      tipsOwedByEmployee: new Map(),
      rangeStart: new Date(2026, 6, 13),
      rangeEnd: new Date(2026, 6, 19, 23, 59, 59, 999),
      timezone: CHI,
    });
    // 40 h straight at $20 plus 2 h weekly OT at $30.
    expect(wagesCents).toBe(40 * 2000 + 2 * 3000);
  });

  it('splits the Chicago week at restaurant days with a day-string range check', () => {
    const run = (rangeStart: Date, rangeEnd: Date) =>
      calculateActualLaborCostForRange({
        employees: [employee()],
        timePunches: [...weekdayShifts, ...sundayEveningShift],
        tipsOwedByEmployee: new Map(),
        rangeStart,
        rangeEnd,
        timezone: CHI,
      }).wagesCents;

    const monToSat = run(new Date(2026, 6, 13), new Date(2026, 6, 18, 23, 59, 59, 999));
    const sunday = run(new Date(2026, 6, 19), new Date(2026, 6, 19, 23, 59, 59, 999));
    const nextMonday = run(new Date(2026, 6, 20), new Date(2026, 6, 20, 23, 59, 59, 999));

    // The Sunday shift is 2 of 42 hours of the week.
    expect(sunday).toBe(40 * 2000 + 2 * 3000 - monToSat);
    expect(sunday).toBeGreaterThan(0);
    expect(nextMonday).toBe(0);
  });
});

describe('shouldIncludeEmployeeInPayroll: deactivation week', () => {
  // Sun 2026-07-19 23:30 CDT = Mon 2026-07-20 04:30Z. The last Chicago
  // payroll week is Mon Jul 13 .. Sun Jul 19.
  const deactivated = employee({ is_active: false, deactivated_at: '2026-07-20T04:30:00Z' });

  it('keeps the employee in the payroll week of the Chicago deactivation day', () => {
    expect(shouldIncludeEmployeeInPayroll(deactivated, parseDateOnly('2026-07-13'), CHI)).toBe(true);
    expect(shouldIncludeEmployeeInPayroll(deactivated, parseDateOnly('2026-07-19'), CHI)).toBe(true);
  });

  it('drops the employee from the next Chicago payroll week', () => {
    expect(shouldIncludeEmployeeInPayroll(deactivated, parseDateOnly('2026-07-20'), CHI)).toBe(false);
  });

  it('reads last_active_date as a calendar day', () => {
    const lastActive = employee({ is_active: false, last_active_date: '2026-07-19' });
    expect(shouldIncludeEmployeeInPayroll(lastActive, parseDateOnly('2026-07-19'), CHI)).toBe(true);
    expect(shouldIncludeEmployeeInPayroll(lastActive, parseDateOnly('2026-07-20'), CHI)).toBe(false);
  });
});

describe('payroll anomaly messages', () => {
  it('shows an orphan clock-out in restaurant-local time', () => {
    const { incompleteShifts } = parseWorkPeriods([punch('clock_out', '2026-07-20T04:30:00Z')], CHI);
    expect(incompleteShifts[0].message).toBe('Clock-out at Jul 19, 11:30 PM has no matching clock-in');
  });

  it('shows a missing clock-out in restaurant-local time', () => {
    const { incompleteShifts } = parseWorkPeriods([punch('clock_in', '2026-07-20T01:00:00Z')], CHI);
    expect(incompleteShifts[0].message).toBe('Missing clock-out for shift started at Jul 19, 8:00 PM');
  });

  it('shows the zone of the restaurant, not the zone of the host', () => {
    // 2026-07-20T04:30Z is 16:30 NZST (UTC+12).
    const { incompleteShifts } = parseWorkPeriods([punch('clock_out', '2026-07-20T04:30:00Z')], AKL);
    expect(incompleteShifts[0].message).toBe('Clock-out at Jul 20, 4:30 PM has no matching clock-in');
  });

  it('shows restaurant-local times for a long gap and a long shift', () => {
    const gap = parseWorkPeriods(
      [punch('clock_in', '2026-07-20T01:00:00Z'), punch('clock_out', '2026-07-20T20:00:00Z')],
      CHI,
    );
    expect(gap.incompleteShifts[0].message).toBe(
      'Gap of 19.0 hours between clock-in (Jul 19, 8:00 PM) and clock-out (Jul 20, 3:00 PM) is too long - likely missing punches',
    );

    const long = parseWorkPeriods(
      [punch('clock_in', '2026-07-20T01:00:00Z'), punch('clock_out', '2026-07-20T18:00:00Z')],
      CHI,
    );
    expect(long.incompleteShifts[0].message).toBe(
      'Shift of 17.0 hours exceeds maximum (16h). Started Jul 19, 8:00 PM, ended Jul 20, 1:00 PM',
    );
  });

  it('shows a consecutive clock-in in restaurant-local time', () => {
    const { incompleteShifts } = parseWorkPeriods(
      [punch('clock_in', '2026-07-20T01:00:00Z'), punch('clock_in', '2026-07-20T02:00:00Z')],
      CHI,
    );
    expect(incompleteShifts[0].message).toBe('Consecutive clock-in without clock-out at Jul 19, 8:00 PM');
  });

  it('shows restaurant-local times in the calculateEmployeePay anomalies', () => {
    const pay = calculateEmployeePay(employee(), [punch('clock_out', '2026-07-20T04:30:00Z')], 0, CHI);
    expect(pay.incompleteShifts?.[0].message).toBe('Clock-out at Jul 19, 11:30 PM has no matching clock-in');
  });
});

describe('weekAlignedFetchStart / weekAlignedFetchEnd: restaurant-local week edges', () => {
  it('widens to the Chicago Monday 00:00 and Sunday 23:59:59.999', () => {
    // 2026-07-22 is a Wednesday. The Chicago week is Mon Jul 20 .. Sun Jul 26.
    const mid = new Date('2026-07-22T17:00:00Z');
    expect(weekAlignedFetchStart('2026-07-22', mid, CHI).toISOString()).toBe('2026-07-20T05:00:00.000Z');
    expect(weekAlignedFetchEnd('2026-07-22', mid, CHI).toISOString()).toBe('2026-07-27T04:59:59.999Z');
  });

  it('widens to the Auckland week edges for an Auckland restaurant', () => {
    const mid = new Date('2026-07-22T00:00:00Z');
    expect(weekAlignedFetchStart('2026-07-22', mid, AKL).toISOString()).toBe('2026-07-19T12:00:00.000Z');
    expect(weekAlignedFetchEnd('2026-07-22', mid, AKL).toISOString()).toBe('2026-07-26T11:59:59.999Z');
  });

  it('keeps a fetch bound that is already wider than the week', () => {
    const early = new Date('2026-07-01T00:00:00Z');
    const late = new Date('2026-08-01T00:00:00Z');
    expect(weekAlignedFetchStart('2026-07-22', early, CHI)).toBe(early);
    expect(weekAlignedFetchEnd('2026-07-22', late, CHI)).toBe(late);
  });
});

describe('getPayPeriodDates bi-weekly: local-field anchor', () => {
  it('puts the anchor day 2024-01-01 at the start of a period on every host', () => {
    expect(getPayPeriodDates(new Date(2024, 0, 1), 'bi-weekly')).toEqual({ start: '2024-01-01', end: '2024-01-14' });
    expect(getPayPeriodDates(new Date(2024, 0, 15), 'bi-weekly')).toEqual({ start: '2024-01-15', end: '2024-01-28' });
    expect(getPayPeriodDates(new Date(2023, 11, 31), 'bi-weekly')).toEqual({ start: '2023-12-18', end: '2023-12-31' });
  });

  it('reads the calendar day of a late-evening day token', () => {
    expect(getPayPeriodDates(new Date(2024, 0, 14, 23, 0), 'bi-weekly')).toEqual({
      start: '2024-01-01',
      end: '2024-01-14',
    });
  });
});

describe('compensation history: created_at tie-break', () => {
  const entry = (id: string, amount_cents: number, created_at: string) => ({
    id,
    employee_id: 'emp-1',
    restaurant_id: 'rest-1',
    compensation_type: 'hourly' as const,
    amount_cents,
    effective_date: '2026-07-01',
    created_at,
  });

  it('picks the entry created last when two entries have the same effective_date', () => {
    const older = entry('a', 1500, '2026-06-20T10:00:00Z');
    const newer = entry('b', 1800, '2026-06-25T10:00:00Z');
    for (const history of [
      [older, newer],
      [newer, older],
    ]) {
      const snapshot = resolveCompensationForDate(employee({ compensation_history: history }), '2026-07-10');
      expect(snapshot.hourly_rate).toBe(1800);
    }
  });
});
