import { describe, it, expect } from 'vitest';
import {
  selectVisibleRosterInputs,
  filterEmployeesForScheduleView,
  buildActiveShiftEmployeeIds,
} from '@/lib/scheduleVisibility';
import type { Employee, Shift } from '@/types/scheduling';

const emp = (id: string, is_active: boolean): Employee =>
  ({ id, name: `Emp ${id}`, is_active } as unknown as Employee);

const shift = (id: string, employee_id: string, status: Shift['status']): Shift =>
  ({
    id,
    employee_id,
    status,
    start_time: '2026-06-29T09:00:00.000Z',
    end_time: '2026-06-29T17:00:00.000Z',
    break_duration: 0,
  } as unknown as Shift);

describe('selectVisibleRosterInputs', () => {
  it('excludes an inactive employee whose only shift is cancelled, and strips the cancelled shift', () => {
    const employees = [emp('active1', true), emp('inactive1', false)];
    const shifts = [
      shift('s1', 'active1', 'scheduled'),
      shift('s2', 'inactive1', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['active1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('includes an inactive employee who has a non-cancelled shift', () => {
    const employees = [emp('inactive1', false)];
    const shifts = [shift('s1', 'inactive1', 'scheduled')];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['inactive1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('always keeps active employees and strips their cancelled shifts', () => {
    const employees = [emp('active1', true)];
    const shifts = [
      shift('s1', 'active1', 'confirmed'),
      shift('s2', 'active1', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.employees.map(e => e.id)).toEqual(['active1']);
    expect(result.shifts.map(s => s.id)).toEqual(['s1']);
  });

  it('removes cancelled shifts regardless of employee', () => {
    const employees = [emp('active1', true), emp('active2', true)];
    const shifts = [
      shift('s1', 'active1', 'cancelled'),
      shift('s2', 'active2', 'cancelled'),
    ];
    const result = selectVisibleRosterInputs(shifts, employees);
    expect(result.shifts).toEqual([]);
    // both employees are active, so they remain even with no live shift
    expect(result.employees.map(e => e.id).sort()).toEqual(['active1', 'active2']);
  });

  it('returns empty arrays for empty inputs', () => {
    expect(selectVisibleRosterInputs([], [])).toEqual({ shifts: [], employees: [] });
  });

  it('matches the grid visibility rule (parity with filterEmployeesForScheduleView)', () => {
    const employees = [
      emp('active1', true),
      emp('inactiveLive', false),
      emp('inactiveCancelled', false),
      emp('inactiveNoShift', false),
    ];
    const shifts = [
      shift('s1', 'active1', 'scheduled'),
      shift('s2', 'inactiveLive', 'confirmed'),
      shift('s3', 'inactiveCancelled', 'cancelled'),
    ];
    const fromVisible = selectVisibleRosterInputs(shifts, employees).employees.map(e => e.id).sort();
    const fromGrid = filterEmployeesForScheduleView(
      employees,
      buildActiveShiftEmployeeIds(shifts),
      null,
      null,
    ).map(e => e.id).sort();
    expect(fromVisible).toEqual(fromGrid);
  });
});
