import { describe, it, expect } from 'vitest';
import type { Employee } from '@/types/scheduling';
import type { Shift } from '@/types/scheduling';
import {
  buildShiftImportPreview,
  getWeekMonday,
  type ShiftImportPreviewResult,
} from '@/utils/shiftImportPreview';
import type { ParsedShift } from '@/utils/slingCsvParser';

const makeEmployee = (id: string, name: string): Employee =>
  ({ id, name, position: 'Server', status: 'active', is_active: true, compensation_type: 'hourly', hourly_rate: 0 } as Employee);

const makeShift = (id: string, employeeId: string, start: string, end: string): Shift =>
  ({ id, restaurant_id: 'rest-1', employee_id: employeeId, start_time: start, end_time: end, break_duration: 0, position: 'Server', status: 'scheduled', is_published: false, locked: false } as Shift);

describe('getWeekMonday', () => {
  it('returns Monday for a Saturday date', () => {
    // Feb 28 2026 is Saturday → Monday is Feb 23
    expect(getWeekMonday('2026-02-28T10:00:00.000')).toBe('2026-02-23');
  });

  it('returns the same date when input is Monday', () => {
    // Feb 23 2026 is Monday
    expect(getWeekMonday('2026-02-23T08:00:00.000')).toBe('2026-02-23');
  });

  it('returns Monday for a Sunday date', () => {
    // Mar 1 2026 is Sunday → Monday is Feb 23
    expect(getWeekMonday('2026-03-01T12:00:00.000')).toBe('2026-02-23');
  });

  it('handles month boundary correctly', () => {
    // Mar 4 2026 is Wednesday → Monday is Mar 2
    expect(getWeekMonday('2026-03-04T09:00:00.000')).toBe('2026-03-02');
  });
});

describe('buildShiftImportPreview', () => {
  const employees = [makeEmployee('emp-1', 'Abraham Dominguez')];
  const employeeMap = { 'Abraham Dominguez': 'emp-1' };

  it('builds preview from parsed shifts with matched employees', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
    });
    expect(result.summary.totalShifts).toBe(1);
    expect(result.summary.readyCount).toBe(1);
    expect(result.shifts[0].status).toBe('ready');
    expect(result.shifts[0].employeeId).toBe('emp-1');
  });

  it('marks shifts as duplicate when overlapping with existing', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const existingShifts: Shift[] = [
      makeShift('shift-1', 'emp-1', '2026-02-28T10:00:00.000', '2026-02-28T23:00:00.000'),
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts,
      publishedWeeks: [],
    });
    expect(result.summary.duplicateCount).toBe(1);
    expect(result.shifts[0].status).toBe('duplicate');
  });

  it('marks shifts as published when target week is locked', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    // Feb 28 2026 is Saturday. Monday of that week is Feb 23.
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: ['2026-02-23'],
    });
    expect(result.summary.publishedCount).toBe(1);
    expect(result.shifts[0].status).toBe('published');
  });

  it('marks shifts as skipped when employee not in employeeMap', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Unknown Person', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap: {},
      existingShifts: [],
      publishedWeeks: [],
    });
    expect(result.summary.skippedCount).toBe(1);
    expect(result.shifts[0].status).toBe('skipped');
  });

  it('skips shifts where start >= end (zero or negative duration)', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T18:00:00.000', endTime: '2026-02-28T10:00:00.000', position: 'Server' },
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T10:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
    });
    expect(result.summary.skippedCount).toBe(2);
    expect(result.summary.readyCount).toBe(0);
  });

  it('passes through newEmployeesCount parameter', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T18:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
      newEmployeesCount: 3,
    });
    expect(result.summary.newEmployeesCount).toBe(3);
  });

  it('defaults newEmployeesCount to 0 when not provided', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T18:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
    });
    expect(result.summary.newEmployeesCount).toBe(0);
  });

  it('calculates total hours correctly', () => {
    const parsedShifts: ParsedShift[] = [
      { employeeName: 'Abraham Dominguez', startTime: '2026-02-28T10:00:00.000', endTime: '2026-02-28T18:00:00.000', position: 'Server' },
      { employeeName: 'Abraham Dominguez', startTime: '2026-03-01T17:00:00.000', endTime: '2026-03-01T23:00:00.000', position: 'Server' },
    ];
    const result = buildShiftImportPreview({
      parsedShifts,
      employeeMap,
      existingShifts: [],
      publishedWeeks: [],
    });
    expect(result.summary.totalHours).toBe(14); // 8 + 6
  });
});
