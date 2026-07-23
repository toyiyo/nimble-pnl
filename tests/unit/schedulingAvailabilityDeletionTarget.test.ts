/**
 * Tests for `buildAvailabilityDeletionTarget` in Scheduling.tsx — a pure
 * extraction of the "resolve the deletion target's personName" glue used
 * when the Remove button inside AvailabilityDialog/AvailabilityExceptionDialog
 * fires. Those editors only carry the row (no employee list of their own);
 * Scheduling.tsx already holds `allEmployees` and fills in `personName`
 * before opening the single shared DeleteAvailabilityDialog instance.
 *
 * Pure extraction (not a component mount) so it's unit-testable without
 * mounting the full Scheduling page — matches the existing convention in
 * this file (see computeOpenShiftCount / buildActiveShiftEmployeeIds).
 */
import { describe, it, expect } from 'vitest';
import { buildAvailabilityDeletionTarget } from '@/pages/Scheduling';
import type { Employee, EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

function mkEmployee(overrides: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    restaurant_id: 'r1',
    position: 'Server',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

const availabilityRow: EmployeeAvailability = {
  id: 'avail-1',
  restaurant_id: 'r1',
  employee_id: 'emp-1',
  day_of_week: 1,
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_available: true,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const exceptionRow: AvailabilityException = {
  id: 'exc-1',
  restaurant_id: 'r1',
  employee_id: 'emp-2',
  date: '2026-03-03',
  is_available: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('buildAvailabilityDeletionTarget', () => {
  it('resolves an availability row to a kind="availability" target with the matched employee name', () => {
    const employees = [mkEmployee({ id: 'emp-1', name: 'Ann Employee' })];
    const target = buildAvailabilityDeletionTarget('availability', availabilityRow, employees);
    expect(target).toEqual({ kind: 'availability', row: availabilityRow, personName: 'Ann Employee' });
  });

  it('resolves an exception row to a kind="exception" target with the matched employee name', () => {
    const employees = [
      mkEmployee({ id: 'emp-1', name: 'Ann Employee' }),
      mkEmployee({ id: 'emp-2', name: 'Bo Staffer' }),
    ];
    const target = buildAvailabilityDeletionTarget('exception', exceptionRow, employees);
    expect(target).toEqual({ kind: 'exception', row: exceptionRow, personName: 'Bo Staffer' });
  });

  it('returns null when no employee matches the row (stale row / employee removed mid-session)', () => {
    const target = buildAvailabilityDeletionTarget('availability', availabilityRow, []);
    expect(target).toBeNull();
  });
});
