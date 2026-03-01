import { describe, it, expect } from 'vitest';
import { filterEmployees, countShiftsForEmployee } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';
import type { Shift } from '@/types/scheduling';

const employees = [
  { id: 'e1', name: 'Alice Smith', position: 'Server' },
  { id: 'e2', name: 'Bob Cook', position: 'Cook' },
  { id: 'e3', name: 'Carol Jones', position: 'Server' },
  { id: 'e4', name: 'Dan Lee', position: null },
];

describe('filterEmployees', () => {
  it('returns all when no search or filter', () => {
    expect(filterEmployees(employees, '', 'all')).toHaveLength(4);
  });

  it('filters by name substring (case-insensitive)', () => {
    expect(filterEmployees(employees, 'alice', 'all')).toHaveLength(1);
    expect(filterEmployees(employees, 'alice', 'all')[0].id).toBe('e1');
  });

  it('filters by role', () => {
    expect(filterEmployees(employees, '', 'Server')).toHaveLength(2);
  });

  it('combines search and role filter', () => {
    expect(filterEmployees(employees, 'carol', 'Server')).toHaveLength(1);
  });

  it('returns empty when nothing matches', () => {
    expect(filterEmployees(employees, 'zzz', 'all')).toHaveLength(0);
  });

  it('handles null position in role filter', () => {
    expect(filterEmployees(employees, '', 'Cook')).toHaveLength(1);
  });
});

describe('countShiftsForEmployee', () => {
  const shifts: Partial<Shift>[] = [
    { id: 's1', employee_id: 'e1', status: 'scheduled' },
    { id: 's2', employee_id: 'e1', status: 'scheduled' },
    { id: 's3', employee_id: 'e1', status: 'cancelled' },
    { id: 's4', employee_id: 'e2', status: 'scheduled' },
  ];

  it('counts non-cancelled shifts for an employee', () => {
    expect(countShiftsForEmployee(shifts as Shift[], 'e1')).toBe(2);
  });

  it('returns 0 for employee with no shifts', () => {
    expect(countShiftsForEmployee(shifts as Shift[], 'e99')).toBe(0);
  });

  it('excludes cancelled shifts', () => {
    expect(countShiftsForEmployee(shifts as Shift[], 'e1')).toBe(2);
  });
});
