import { describe, it, expect } from 'vitest';
import { filterEmployees, countShiftsForEmployee } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';
import type { Shift } from '@/types/scheduling';

function mockShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    start_time: '2026-03-01T09:00:00Z',
    end_time: '2026-03-01T17:00:00Z',
    break_duration: 30,
    position: 'Server',
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    ...overrides,
  };
}

const employees = [
  { id: 'emp-1', name: 'Alice Johnson', position: 'Server', area: 'Front of House' },
  { id: 'emp-2', name: 'Bob Smith', position: 'Cook', area: 'Back of House' },
  { id: 'emp-3', name: 'Charlie Brown', position: 'Server', area: 'Bar' },
  { id: 'emp-4', name: 'Diana Prince', position: null, area: undefined },
];

describe('filterEmployees', () => {
  it('returns all employees when search is empty and role is "all"', () => {
    const result = filterEmployees(employees, '', 'all', 'all');
    expect(result).toEqual(employees);
  });

  it('filters by name case-insensitively', () => {
    const result = filterEmployees(employees, 'alice', 'all', 'all');
    expect(result).toEqual([employees[0]]);
  });

  it('filters by name with mixed case input', () => {
    const result = filterEmployees(employees, 'BOB', 'all', 'all');
    expect(result).toEqual([employees[1]]);
  });

  it('filters by role', () => {
    const result = filterEmployees(employees, '', 'all', 'Server');
    expect(result).toEqual([employees[0], employees[2]]);
  });

  it('combines name search and role filter', () => {
    const result = filterEmployees(employees, 'charlie', 'all', 'Server');
    expect(result).toEqual([employees[2]]);
  });

  it('returns empty array when no matches', () => {
    const result = filterEmployees(employees, 'Zara', 'all', 'Cook');
    expect(result).toEqual([]);
  });

  it('excludes employees with null position when filtering by role', () => {
    const result = filterEmployees(employees, '', 'all', 'Server');
    expect(result).not.toContainEqual(employees[3]);
  });

  it('includes employees with null position when role is "all"', () => {
    const result = filterEmployees(employees, '', 'all', 'all');
    expect(result).toContainEqual(employees[3]);
  });

  it('filters by area', () => {
    const result = filterEmployees(employees, '', 'Front of House', 'all');
    expect(result).toEqual([employees[0]]);
  });

  it('combines area and role filter (AND logic)', () => {
    const result = filterEmployees(employees, '', 'Front of House', 'Server');
    expect(result).toEqual([employees[0]]);
  });

  it('returns empty when area and role have no overlap', () => {
    const result = filterEmployees(employees, '', 'Back of House', 'Server');
    expect(result).toEqual([]);
  });

  it('includes employees with undefined area when area filter is "all"', () => {
    const result = filterEmployees(employees, '', 'all', 'all');
    expect(result).toContainEqual(employees[3]);
  });

  it('excludes employees with undefined area when filtering by specific area', () => {
    const result = filterEmployees(employees, '', 'Front of House', 'all');
    expect(result).not.toContainEqual(employees[3]);
  });

  it('combines search, area, and role filter', () => {
    const result = filterEmployees(employees, 'alice', 'Front of House', 'Server');
    expect(result).toEqual([employees[0]]);
  });
});

describe('countShiftsForEmployee', () => {
  it('counts shifts for a specific employee', () => {
    const shifts = [
      mockShift({ id: 's1', employee_id: 'emp-1', status: 'scheduled' }),
      mockShift({ id: 's2', employee_id: 'emp-1', status: 'confirmed' }),
      mockShift({ id: 's3', employee_id: 'emp-1', status: 'completed' }),
    ];
    expect(countShiftsForEmployee(shifts, 'emp-1')).toBe(3);
  });

  it('excludes cancelled shifts', () => {
    const shifts = [
      mockShift({ id: 's1', employee_id: 'emp-1', status: 'scheduled' }),
      mockShift({ id: 's2', employee_id: 'emp-1', status: 'cancelled' }),
      mockShift({ id: 's3', employee_id: 'emp-1', status: 'confirmed' }),
    ];
    expect(countShiftsForEmployee(shifts, 'emp-1')).toBe(2);
  });

  it('returns 0 when no shifts match the employee', () => {
    const shifts = [
      mockShift({ id: 's1', employee_id: 'emp-2' }),
      mockShift({ id: 's2', employee_id: 'emp-3' }),
    ];
    expect(countShiftsForEmployee(shifts, 'emp-99')).toBe(0);
  });

  it('returns 0 for an empty shifts array', () => {
    expect(countShiftsForEmployee([], 'emp-1')).toBe(0);
  });

  it('counts only the specified employee shifts, ignoring others', () => {
    const shifts = [
      mockShift({ id: 's1', employee_id: 'emp-1', status: 'scheduled' }),
      mockShift({ id: 's2', employee_id: 'emp-2', status: 'scheduled' }),
      mockShift({ id: 's3', employee_id: 'emp-1', status: 'confirmed' }),
      mockShift({ id: 's4', employee_id: 'emp-3', status: 'completed' }),
    ];
    expect(countShiftsForEmployee(shifts, 'emp-1')).toBe(2);
  });
});
