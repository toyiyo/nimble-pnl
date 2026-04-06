import { describe, it, expect } from 'vitest';
import { formatKitchenTime, calculateShiftHours, generateScheduleFilename } from '@/utils/scheduleExport';
import type { Shift } from '@/types/scheduling';

describe('formatKitchenTime', () => {
  it('formats morning to afternoon shift', () => {
    expect(formatKitchenTime('2026-04-01T06:00:00', '2026-04-01T14:00:00')).toBe('6A-2P');
  });

  it('formats afternoon to evening shift', () => {
    expect(formatKitchenTime('2026-04-01T16:00:00', '2026-04-01T22:00:00')).toBe('4P-10P');
  });

  it('formats shift ending at midnight as CL (close)', () => {
    expect(formatKitchenTime('2026-04-01T16:00:00', '2026-04-02T00:00:00')).toBe('4P-CL');
  });

  it('formats shift ending at 11:30 PM as CL', () => {
    expect(formatKitchenTime('2026-04-01T16:00:00', '2026-04-01T23:30:00')).toBe('4P-CL');
  });

  it('formats shift with minutes', () => {
    expect(formatKitchenTime('2026-04-01T06:30:00', '2026-04-01T14:30:00')).toBe('6:30A-2:30P');
  });

  it('formats noon correctly', () => {
    expect(formatKitchenTime('2026-04-01T12:00:00', '2026-04-01T20:00:00')).toBe('12P-8P');
  });
});

describe('calculateShiftHours', () => {
  it('calculates hours for a standard shift', () => {
    const shift = { start_time: '2026-04-01T08:00:00', end_time: '2026-04-01T16:00:00', break_duration: 0 } as Shift;
    expect(calculateShiftHours(shift)).toBe(8);
  });

  it('subtracts break duration', () => {
    const shift = { start_time: '2026-04-01T08:00:00', end_time: '2026-04-01T16:00:00', break_duration: 30 } as Shift;
    expect(calculateShiftHours(shift)).toBe(7.5);
  });

  it('returns 0 when break equals shift duration', () => {
    const shift = { start_time: '2026-04-01T08:00:00', end_time: '2026-04-01T09:00:00', break_duration: 60 } as Shift;
    expect(calculateShiftHours(shift)).toBe(0);
  });

  it('clamps to 0 when break exceeds shift duration', () => {
    const shift = { start_time: '2026-04-01T08:00:00', end_time: '2026-04-01T09:00:00', break_duration: 120 } as Shift;
    expect(calculateShiftHours(shift)).toBe(0);
  });
});

describe('generateScheduleFilename', () => {
  it('generates filename with date range', () => {
    const start = new Date(2026, 2, 30); // March 30
    const end = new Date(2026, 3, 5); // April 5
    expect(generateScheduleFilename(start, end)).toBe('schedule_2026-03-30_to_2026-04-05');
  });

  it('appends suffix when provided', () => {
    const start = new Date(2026, 2, 30);
    const end = new Date(2026, 3, 5);
    expect(generateScheduleFilename(start, end, 'BOH')).toBe('schedule_2026-03-30_to_2026-04-05_BOH');
  });
});
