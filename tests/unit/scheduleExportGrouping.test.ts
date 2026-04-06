import { describe, it, expect } from 'vitest';
import { groupEmployees, UNASSIGNED_LABEL } from '@/lib/scheduleGrouping';
import type { Employee } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee> & { name: string; position: string }): Employee {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'rest-1',
    status: 'active',
    created_at: '',
    updated_at: '',
    is_active: true,
    compensation_type: 'hourly',
    hourly_rate: 1500,
    ...overrides,
  } as Employee;
}

describe('groupEmployees edge cases for export', () => {
  it('whitespace-only area maps to Unassigned', () => {
    const emp = makeEmployee({ name: 'Blank Area', position: 'Cook', area: '   ' });
    const result = groupEmployees([emp], 'area');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe(UNASSIGNED_LABEL);
    expect(result[0].employees).toHaveLength(1);
  });

  it('undefined area maps to Unassigned', () => {
    const emp = makeEmployee({ name: 'No Area', position: 'Cook' });
    const result = groupEmployees([emp], 'area');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe(UNASSIGNED_LABEL);
  });

  it('user-created area named "Unassigned" stays separate from actual unassigned', () => {
    const assigned = makeEmployee({ name: 'Has Area', position: 'Cook', area: 'Unassigned' });
    const noArea = makeEmployee({ name: 'No Area', position: 'Server' });
    const result = groupEmployees([assigned, noArea], 'area');
    // "Unassigned" (user-created) is a real key, empty-string is the sentinel
    // Both resolve to label "Unassigned" but are separate groups because
    // user-created "Unassigned" has a non-empty key
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('Unassigned');
    expect(result[0].employees[0].name).toBe('Has Area');
    expect(result[1].label).toBe(UNASSIGNED_LABEL);
    expect(result[1].employees[0].name).toBe('No Area');
  });

  it('groups with position mode never produce Unassigned (position is required)', () => {
    const emp = makeEmployee({ name: 'Chef', position: 'Chef' });
    const result = groupEmployees([emp], 'position');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Chef');
  });

  it('returns empty for empty employees with area mode', () => {
    expect(groupEmployees([], 'area')).toEqual([]);
  });

  it('returns single group with empty label for none mode', () => {
    const emp = makeEmployee({ name: 'Test', position: 'Cook', area: 'BOH' });
    const result = groupEmployees([emp], 'none');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('');
    expect(result[0].employees).toHaveLength(1);
  });
});
