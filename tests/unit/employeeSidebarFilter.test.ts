import { describe, it, expect } from 'vitest';
import { filterEmployees } from '@/components/scheduling/ShiftPlanner/EmployeeSidebar';

describe('filterEmployees with employment type', () => {
  const employees = [
    { id: '1', name: 'Alice', position: 'Server', area: 'FOH', employment_type: 'full_time' as const },
    { id: '2', name: 'Bob', position: 'Cook', area: 'BOH', employment_type: 'part_time' as const },
    { id: '3', name: 'Carol', position: 'Server', area: 'FOH', employment_type: 'part_time' as const },
  ];

  it('returns all when employmentType is "all"', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'all');
    expect(result).toHaveLength(3);
  });

  it('filters to full_time only', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'full_time');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice');
  });

  it('filters to part_time only', () => {
    const result = filterEmployees(employees, '', 'all', 'all', 'part_time');
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.name)).toEqual(['Bob', 'Carol']);
  });

  it('combines employment type with role filter', () => {
    const result = filterEmployees(employees, '', 'all', 'Server', 'part_time');
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Carol');
  });
});
