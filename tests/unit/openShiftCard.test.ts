/**
 * Unit Tests: Open Shift Card helpers
 *
 * Tests pure functions from openShiftHelpers.ts:
 * - formatCompactTime: compact 12-hour time labels
 * - hasScheduleConflict: overlap detection between an open shift and an
 *   employee's existing shifts, used by AvailableShiftsPage's conflict map.
 *
 * Note (T11): computeOpenSpots and classifyCapacity have been removed — they were
 * the exact-match path replaced by the coverage engine (computeSlotCoverage).
 * Their removal is guarded by: tests/unit/openShiftHelpersCleanup.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  formatCompactTime,
  hasScheduleConflict,
} from '@/lib/openShiftHelpers';
import { DEFAULT_TIMEZONE } from '@/lib/restaurantClock';

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

// ---- Conflict detection logic (AvailableShiftsPage's conflict map) ----

describe('hasScheduleConflict', () => {
  const date = '2026-04-18';
  // Employee shifts are instants (case (b)); pin them at the restaurant's
  // default timezone so overlap is decided by restaurant-local wall clock,
  // not the machine running the test.
  const tz = DEFAULT_TIMEZONE;

  it('returns false when employee has no shifts', () => {
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', [], tz)).toBe(false);
  });

  it('returns false when shift is on a different date', () => {
    const shifts = [{ start_time: '2026-04-19T14:00:00Z', end_time: '2026-04-19T20:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '14:00:00', '20:00:00', shifts, tz)).toBe(false);
  });

  it('detects overlap when shifts share the same date and times', () => {
    const shifts = [{ start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '09:00:00', '15:00:00', shifts, tz)).toBe(true);
  });

  it('detects partial overlap (open shift starts before employee shift ends)', () => {
    const shifts = [{ start_time: '2026-04-18T16:00:00Z', end_time: '2026-04-18T22:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '09:00:00', '11:30:00', shifts, tz)).toBe(true);
  });

  it('returns false for adjacent shifts (no overlap)', () => {
    const shifts = [{ start_time: '2026-04-18T08:00:00Z', end_time: '2026-04-18T14:00:00Z', status: 'scheduled' }];
    expect(hasScheduleConflict(date, '09:00:00', '20:00:00', shifts, tz)).toBe(false);
  });

  it('ignores cancelled shifts', () => {
    const shifts = [{ start_time: '2026-04-18T14:00:00Z', end_time: '2026-04-18T20:00:00Z', status: 'cancelled' }];
    expect(hasScheduleConflict(date, '09:00:00', '15:00:00', shifts, tz)).toBe(false);
  });
});
