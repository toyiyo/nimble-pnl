/**
 * Unit Tests: Open Shift Card helpers
 *
 * Tests pure functions from openShiftHelpers.ts:
 * - formatCompactTime: compact 12-hour time labels
 * - computeOpenSpots: available slot calculation
 * - classifyCapacity: slot fill status
 *
 * Also tests conflict detection logic from AvailableShiftsPage
 * (extracted into pure helper for testability).
 */

import { describe, it, expect } from 'vitest';
import {
  formatCompactTime,
  computeOpenSpots,
  classifyCapacity,
} from '@/lib/openShiftHelpers';

// ---- formatCompactTime ----

describe('formatCompactTime', () => {
  it('formats midnight as "12a"', () => {
    expect(formatCompactTime('00:00')).toBe('12a');
  });

  it('formats noon as "12p"', () => {
    expect(formatCompactTime('12:00')).toBe('12p');
  });

  it('formats 9am without leading zero', () => {
    expect(formatCompactTime('09:00')).toBe('9a');
  });

  it('formats 2pm correctly', () => {
    expect(formatCompactTime('14:00')).toBe('2p');
  });

  it('formats 9:30am with minutes', () => {
    expect(formatCompactTime('09:30')).toBe('9:30a');
  });

  it('formats 22:45 as "10:45p"', () => {
    expect(formatCompactTime('22:45')).toBe('10:45p');
  });

  it('omits :00 for whole hours', () => {
    expect(formatCompactTime('11:00')).toBe('11a');
    expect(formatCompactTime('13:00')).toBe('1p');
  });

  it('pads minutes with leading zero', () => {
    expect(formatCompactTime('10:05')).toBe('10:05a');
  });

  it('handles time strings with seconds', () => {
    // HH:MM:SS - only first two segments matter
    expect(formatCompactTime('16:00:00')).toBe('4p');
    expect(formatCompactTime('08:30:00')).toBe('8:30a');
  });
});

// ---- computeOpenSpots ----

describe('computeOpenSpots', () => {
  it('returns capacity minus assigned count', () => {
    expect(computeOpenSpots(3, 1)).toBe(2);
  });

  it('returns 0 when fully booked', () => {
    expect(computeOpenSpots(3, 3)).toBe(0);
  });

  it('clamps to 0 when over-assigned', () => {
    expect(computeOpenSpots(2, 5)).toBe(0);
  });

  it('defaults capacity to 1 when undefined', () => {
    expect(computeOpenSpots(undefined, 0)).toBe(1);
    expect(computeOpenSpots(undefined, 1)).toBe(0);
  });

  it('returns full capacity when no one assigned', () => {
    expect(computeOpenSpots(5, 0)).toBe(5);
  });
});

// ---- classifyCapacity ----

describe('classifyCapacity', () => {
  it('returns "empty" when no one is assigned', () => {
    expect(classifyCapacity(4, 0)).toBe('empty');
  });

  it('returns "partial" when partially filled', () => {
    expect(classifyCapacity(4, 2)).toBe('partial');
  });

  it('returns "full" when at capacity', () => {
    expect(classifyCapacity(4, 4)).toBe('full');
  });

  it('returns "full" when over capacity', () => {
    expect(classifyCapacity(2, 5)).toBe('full');
  });

  it('uses default capacity of 1 when undefined', () => {
    expect(classifyCapacity(undefined, 0)).toBe('empty');
    expect(classifyCapacity(undefined, 1)).toBe('full');
  });
});

// ---- Conflict detection logic (mirroring AvailableShiftsPage) ----

/**
 * Pure function extracted from AvailableShiftsPage's conflict detection.
 * Returns true if the open shift time overlaps with any of the employee's shifts.
 */
function hasScheduleConflict(
  openShiftDate: string,
  openStartTime: string, // HH:MM:SS
  openEndTime: string,   // HH:MM:SS
  employeeShifts: Array<{ start_time: string; end_time: string; status: string }>,
): boolean {
  const [startH, startM] = openStartTime.split(':').map(Number);
  const [endH, endM] = openEndTime.split(':').map(Number);
  const osStart = startH * 60 + startM;
  const osEnd = endH * 60 + endM;

  return employeeShifts.some((s) => {
    if (s.status === 'cancelled') return false;
    const sDate = s.start_time.split('T')[0];
    if (sDate !== openShiftDate) return false;
    const sStart = new Date(s.start_time);
    const sEnd = new Date(s.end_time);
    const sStartMin = sStart.getHours() * 60 + sStart.getMinutes();
    const sEndMin = sEnd.getHours() * 60 + sEnd.getMinutes();
    return sStartMin < osEnd && sEndMin > osStart;
  });
}

describe('hasScheduleConflict', () => {
  const date = '2026-04-18';

  it('returns false when employee has no shifts', () => {
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', [])).toBe(false);
  });

  it('returns false when shift is on a different date', () => {
    const shifts = [{ start_time: '2026-04-19T14:00:00Z', end_time: '2026-04-19T20:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', shifts)).toBe(false);
  });

  it('detects overlap when shifts share the same date and times', () => {
    const shifts = [{ start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', shifts)).toBe(true);
  });

  it('detects partial overlap (open shift starts before employee shift ends)', () => {
    const shifts = [{ start_time: '2026-04-18T16:00:00Z', end_time: '2026-04-18T22:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '14:00:00', '18:00:00', shifts)).toBe(true);
  });

  it('returns false for adjacent shifts (no overlap)', () => {
    const shifts = [{ start_time: '2026-04-18T08:00:00Z', end_time: '2026-04-18T14:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', shifts)).toBe(false);
  });

  it('ignores cancelled shifts', () => {
    const shifts = [{ start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', status: 'cancelled' }];
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', shifts)).toBe(false);
  });
});
