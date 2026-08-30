import { describe, it, expect } from 'vitest';
import {
  calculateActualLaborCostForMonth,
  calculateActualLaborCostForRange,
} from '@/services/laborCalculations';
import type { Employee } from '@/types/scheduling';
import type { TimePunch } from '@/types/timeTracking';

const baseEmployee: Employee = {
  id: 'e1',
  restaurant_id: 'r1',
  name: 'Test Employee',
  position: 'Server',
  status: 'active',
  is_active: true,
  compensation_type: 'hourly',
  hourly_rate: 2000, // $20.00/hr in cents
  is_exempt: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as Employee;

function punch(employeeId: string, time: string, type: 'clock_in' | 'clock_out'): TimePunch {
  return {
    id: `${employeeId}-${time}-${type}`,
    employee_id: employeeId,
    restaurant_id: 'r1',
    punch_type: type,
    punch_time: new Date(time).toISOString(),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as TimePunch;
}

describe('calculateActualLaborCostForRange', () => {
  it('equals calculateActualLaborCostForMonth for a one-month range', () => {
    const employees = [baseEmployee];
    const timePunches = [
      punch('e1', '2026-04-06T15:00:00Z', 'clock_in'),
      punch('e1', '2026-04-06T23:00:00Z', 'clock_out'),
    ];
    const tipsOwedByEmployee = new Map([['e1', 5000]]);

    const forRange = calculateActualLaborCostForRange({
      employees,
      timePunches,
      tipsOwedByEmployee,
      rangeStart: new Date('2026-04-01T00:00:00Z'),
      rangeEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });

    const forMonth = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00Z'),
      monthEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });

    expect(forRange).toEqual(forMonth);
    // 8h x 2000c = 16,000c wages + 5,000c tips = 21,000c.
    expect(forRange.actualLaborCents).toBe(21_000);
  });

  it('covers a two-month range as the sum of the two months, with OT banding', () => {
    const employees = [baseEmployee];
    // Six 10-hour shifts across the April/May boundary: one clock-in week,
    // 60 hours, so the OT banding applies.
    const timePunches = [
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
    ].flatMap((day) => [
      punch('e1', `${day}T08:00:00Z`, 'clock_in'),
      punch('e1', `${day}T18:00:00Z`, 'clock_out'),
    ]);
    const tipsOwedByEmployee = new Map<string, number>();

    const forRange = calculateActualLaborCostForRange({
      employees,
      timePunches,
      tipsOwedByEmployee,
      rangeStart: new Date('2026-04-01T00:00:00Z'),
      rangeEnd: new Date('2026-05-31T23:59:59Z'),
      timezone: 'UTC',
    });

    const april = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-04-01T00:00:00Z'),
      monthEnd: new Date('2026-04-30T23:59:59Z'),
      timezone: 'UTC',
    });
    const may = calculateActualLaborCostForMonth({
      employees,
      timePunches,
      tipsOwedByEmployee,
      monthStart: new Date('2026-05-01T00:00:00Z'),
      monthEnd: new Date('2026-05-31T23:59:59Z'),
      timezone: 'UTC',
    });

    // The proportional distribution guarantees per-day cents sum to the
    // week total, so the range equals the sum of the two month clips.
    expect(forRange.wagesCents).toBe(april.wagesCents + may.wagesCents);
    // 60h straight time is 120,000c; the OT banding pays more.
    expect(forRange.wagesCents).toBeGreaterThan(120_000);
  });
});
