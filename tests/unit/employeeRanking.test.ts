import { describe, it, expect } from 'vitest';
import { rankEmployeesForShift } from '@/lib/employeeRanking';
import type { Employee } from '@/types/scheduling';

function makeEmployee(overrides: Partial<Employee> & { id: string; name: string }): Employee {
  return {
    restaurant_id: 'r1',
    position: 'Server',
    status: 'active',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Employee;
}

describe('rankEmployeesForShift', () => {
  it('sorts position-matching employees before non-matching ones', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'Cook' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Server' }),
      makeEmployee({ id: 'e3', name: 'Bob', position: 'Cook' }),
    ];

    const ranked = rankEmployeesForShift(employees, { position: 'Cook' });

    expect(ranked.map((e) => e.id)).toEqual(['e1', 'e3', 'e2']);
  });

  it('preserves relative (alphabetical-by-name) order within the matching group', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'Cook' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Cook' }),
    ];

    const ranked = rankEmployeesForShift(employees, { position: 'Cook' });

    // Stable sort: original relative order preserved within the group.
    expect(ranked.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('sorts area-matching employees before non-matching ones when area is provided', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'Server', area: 'Patio' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Server', area: 'Bar' }),
      makeEmployee({ id: 'e3', name: 'Bob', position: 'Server', area: 'Bar' }),
    ];

    const ranked = rankEmployeesForShift(employees, { area: 'Bar' });

    expect(ranked.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });

  it('prioritizes area match over position match when both are supplied', () => {
    const employees = [
      // Matches position only
      makeEmployee({ id: 'e1', name: 'Ann', position: 'Cook', area: 'Patio' }),
      // Matches area only
      makeEmployee({ id: 'e2', name: 'Ben', position: 'Server', area: 'Kitchen' }),
      // Matches neither
      makeEmployee({ id: 'e3', name: 'Cid', position: 'Server', area: 'Patio' }),
      // Matches both
      makeEmployee({ id: 'e4', name: 'Dee', position: 'Cook', area: 'Kitchen' }),
    ];

    const ranked = rankEmployeesForShift(employees, { position: 'Cook', area: 'Kitchen' });

    expect(ranked.map((e) => e.id)).toEqual(['e4', 'e2', 'e1', 'e3']);
  });

  it('is a no-op ordering when neither position nor area is provided', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'Cook' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Server' }),
    ];

    const ranked = rankEmployeesForShift(employees, {});

    expect(ranked.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('does case-insensitive position/area matching', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'cook' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Server' }),
    ];

    const ranked = rankEmployeesForShift(employees, { position: 'COOK' });

    expect(ranked.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('treats an employee with no area as non-matching when area context is given', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Ann', position: 'Server' }), // no area
      makeEmployee({ id: 'e2', name: 'Ben', position: 'Server', area: 'Bar' }),
    ];

    const ranked = rankEmployeesForShift(employees, { area: 'Bar' });

    expect(ranked.map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  it('does not mutate the input array', () => {
    const employees = [
      makeEmployee({ id: 'e1', name: 'Zack', position: 'Cook' }),
      makeEmployee({ id: 'e2', name: 'Amy', position: 'Server' }),
    ];
    const original = [...employees];

    rankEmployeesForShift(employees, { position: 'Cook' });

    expect(employees).toEqual(original);
  });

  it('returns an empty array for an empty employee list', () => {
    expect(rankEmployeesForShift([], { position: 'Cook' })).toEqual([]);
  });
});
