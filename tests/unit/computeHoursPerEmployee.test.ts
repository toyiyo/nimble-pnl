import { describe, it, expect } from 'vitest';
import { computeHoursPerEmployee } from '@/hooks/useShiftPlanner';
import type { Shift } from '@/types/scheduling';

function makeShift(overrides: Partial<Shift> & { employee_id: string; start_time: string; end_time: string }): Shift {
  return {
    id: crypto.randomUUID(),
    restaurant_id: 'r1',
    position: 'Server',
    notes: '',
    status: 'scheduled',
    is_published: false,
    locked: false,
    break_duration: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Shift;
}

describe('computeHoursPerEmployee', () => {
  it('returns empty map for no shifts', () => {
    const result = computeHoursPerEmployee([]);
    expect(result.size).toBe(0);
  });

  it('computes hours for a single employee with one shift', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.get('e1')).toBe(8);
  });

  it('sums hours across multiple shifts for the same employee', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
      }),
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-04T09:00:00Z',
        end_time: '2026-03-04T17:00:00Z',
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.get('e1')).toBe(16);
  });

  it('groups hours by employee', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
      }),
      makeShift({
        employee_id: 'e2',
        start_time: '2026-03-03T10:00:00Z',
        end_time: '2026-03-03T14:00:00Z',
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.get('e1')).toBe(8);
    expect(result.get('e2')).toBe(4);
  });

  it('excludes cancelled shifts', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
        status: 'cancelled',
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.has('e1')).toBe(false);
  });

  it('subtracts break duration', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
        break_duration: 30, // 30 minutes
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    // 8h - 0.5h = 7.5h → rounded to 8
    expect(result.get('e1')).toBe(8);
  });

  it('subtracts break duration resulting in lower rounded value', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
        break_duration: 60, // 60 minutes
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    // 8h - 1h = 7h
    expect(result.get('e1')).toBe(7);
  });

  it('skips shifts without employee_id', () => {
    const shifts = [
      makeShift({
        employee_id: '',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T17:00:00Z',
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.size).toBe(0);
  });

  it('rounds to nearest integer', () => {
    const shifts = [
      makeShift({
        employee_id: 'e1',
        start_time: '2026-03-03T09:00:00Z',
        end_time: '2026-03-03T15:15:00Z', // 6.25 hours
      }),
    ];
    const result = computeHoursPerEmployee(shifts);
    expect(result.get('e1')).toBe(6);
  });
});
