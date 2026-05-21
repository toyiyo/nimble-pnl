import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useEmployeesMissingAvailability } from '@/hooks/useEmployeesMissingAvailability';
import type { EmployeeAvailability } from '@/types/scheduling';

type Emp = { id: string; name: string; status: 'active' | 'inactive' | 'terminated' };

const av = (employee_id: string, day_of_week = 1): EmployeeAvailability =>
  ({
    id: `av-${employee_id}-${day_of_week}`,
    restaurant_id: 'r1',
    employee_id,
    day_of_week,
    start_time: '09:00:00',
    end_time: '17:00:00',
    is_available: true,
    notes: null,
    created_at: '2026-05-21T00:00:00Z',
    updated_at: '2026-05-21T00:00:00Z',
  } as EmployeeAvailability);

describe('useEmployeesMissingAvailability', () => {
  it('returns active employees with zero matching availability rows', () => {
    const employees: Emp[] = [
      { id: 'e1', name: 'Alice', status: 'active' },     // missing
      { id: 'e2', name: 'Bob',   status: 'active' },     // has row
      { id: 'e3', name: 'Carol', status: 'inactive' },   // excluded (inactive)
      { id: 'e4', name: 'Dan',   status: 'active' },     // missing
    ];
    const availability = [av('e2', 1)];

    const { result } = renderHook(() =>
      useEmployeesMissingAvailability(employees as never, availability),
    );

    expect(result.current.map((e) => e.id)).toEqual(['e1', 'e4']);
  });

  it('treats a single row (any day) as "has availability"', () => {
    const employees: Emp[] = [{ id: 'e1', name: 'Alice', status: 'active' }];
    const { result } = renderHook(() =>
      useEmployeesMissingAvailability(employees as never, [av('e1', 3)]),
    );
    expect(result.current).toEqual([]);
  });

  it('returns empty list when employees is empty', () => {
    const { result } = renderHook(() =>
      useEmployeesMissingAvailability([], []),
    );
    expect(result.current).toEqual([]);
  });

  it('is referentially stable when inputs do not change', () => {
    const employees: Emp[] = [{ id: 'e1', name: 'Alice', status: 'active' }];
    const availability: EmployeeAvailability[] = [];
    const { result, rerender } = renderHook(
      ({ e, a }) => useEmployeesMissingAvailability(e as never, a),
      { initialProps: { e: employees, a: availability } },
    );
    const first = result.current;
    rerender({ e: employees, a: availability });
    expect(result.current).toBe(first);
  });
});
