import { describe, it, expect } from 'vitest';
import { getShiftStatusClass, filterEmployeesForScheduleView } from '@/pages/Scheduling';
import { buildShiftChangeDescription } from '@/hooks/useShifts';

describe('getShiftStatusClass', () => {
  it('returns conflict styling when conflicts are present', () => {
    expect(getShiftStatusClass('confirmed', true)).toBe('border-l-warning bg-warning/5 hover:bg-warning/10');
  });

  it('returns status styling when no conflicts', () => {
    expect(getShiftStatusClass('confirmed', false)).toBe('border-l-success');
    expect(getShiftStatusClass('cancelled', false)).toBe('border-l-destructive opacity-60');
    expect(getShiftStatusClass('scheduled', false)).toBe('border-l-primary/50');
  });
});

describe('buildShiftChangeDescription', () => {
  it('describes deleted shifts with preserved locked shifts', () => {
    expect(buildShiftChangeDescription(2, 1, 'deleted')).toBe('2 shifts deleted. 1 locked shift was preserved.');
  });

  it('describes updated shifts with unchanged locked shifts', () => {
    expect(buildShiftChangeDescription(3, 2, 'updated')).toBe('3 shifts updated. 2 locked shifts were unchanged.');
  });

  it('handles singular grammar correctly', () => {
    expect(buildShiftChangeDescription(1, 0, 'deleted')).toBe('1 shift deleted.');
    expect(buildShiftChangeDescription(1, 1, 'updated')).toBe('1 shift updated. 1 locked shift was unchanged.');
  });
});

describe('filterEmployeesForScheduleView', () => {
  const activeWithShifts = { id: '1', name: 'Alice', is_active: true, position: 'Server' };
  const activeNoShifts = { id: '2', name: 'Bob', is_active: true, position: 'Cook' };
  const inactiveWithShifts = { id: '3', name: 'Carol', is_active: false, position: 'Server' };
  const inactiveNoShifts = { id: '4', name: 'Dave', is_active: false, position: 'Cook' };
  const allEmployees = [activeWithShifts, activeNoShifts, inactiveWithShifts, inactiveNoShifts];
  const shiftEmployeeIds = new Set(['1', '3']);

  it('includes active employees regardless of shifts', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, null);
    expect(result.map(e => e.id)).toContain('1');
    expect(result.map(e => e.id)).toContain('2');
  });

  it('includes inactive employees only if they have shifts', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, null);
    expect(result.map(e => e.id)).toContain('3');
    expect(result.map(e => e.id)).not.toContain('4');
  });

  it('applies position filter when provided', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, 'Server');
    expect(result.map(e => e.id)).toEqual(['1', '3']);
  });

  it('treats "all" same as null — shows all eligible employees', () => {
    const result = filterEmployeesForScheduleView(allEmployees as any, shiftEmployeeIds, 'all');
    expect(result.map(e => e.id)).toEqual(['1', '2', '3']);
  });

  it('returns empty array when no employees match', () => {
    const result = filterEmployeesForScheduleView([], new Set(), null);
    expect(result).toEqual([]);
  });
});
