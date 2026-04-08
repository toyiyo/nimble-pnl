import { describe, it, expect } from 'vitest';
import { groupEmployees, type GroupByMode } from '@/lib/scheduleGrouping';
import type { Employee } from '@/types/scheduling';

// Minimal employee factory for testing
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

const alice = makeEmployee({ name: 'Alice', position: 'Cook', area: 'Back of House' });
const bob = makeEmployee({ name: 'Bob', position: 'Server', area: 'Front of House' });
const charlie = makeEmployee({ name: 'Charlie', position: 'Cook', area: 'Back of House' });
const diana = makeEmployee({ name: 'Diana', position: 'Bartender', area: 'Bar' });
const eve = makeEmployee({ name: 'Eve', position: 'Server' }); // no area

const employees = [bob, eve, alice, diana, charlie];

describe('groupEmployees', () => {
  it('returns a single group with all employees sorted by name when mode is none', () => {
    const result = groupEmployees(employees, 'none');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('');
    expect(result[0].employees.map(e => e.name)).toEqual([
      'Alice', 'Bob', 'Charlie', 'Diana', 'Eve',
    ]);
  });

  it('groups by area with Unassigned last', () => {
    const result = groupEmployees(employees, 'area');
    const labels = result.map(g => g.label);
    expect(labels).toEqual(['Back of House', 'Bar', 'Front of House', 'Unassigned']);
    // Back of House has Alice, Charlie
    expect(result[0].employees.map(e => e.name)).toEqual(['Alice', 'Charlie']);
    // Unassigned has Eve
    expect(result[3].employees.map(e => e.name)).toEqual(['Eve']);
  });

  it('groups by position', () => {
    const result = groupEmployees(employees, 'position');
    const labels = result.map(g => g.label);
    expect(labels).toEqual(['Bartender', 'Cook', 'Server']);
    expect(result[1].employees.map(e => e.name)).toEqual(['Alice', 'Charlie']);
    expect(result[2].employees.map(e => e.name)).toEqual(['Bob', 'Eve']);
  });

  it('returns empty array for no employees', () => {
    const result = groupEmployees([], 'area');
    expect(result).toEqual([]);
  });

  it('handles all employees having the same area', () => {
    const sameArea = employees.map(e => ({ ...e, area: 'Kitchen' }));
    const result = groupEmployees(sameArea, 'area');
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('Kitchen');
    expect(result[0].employees).toHaveLength(5);
  });
});
