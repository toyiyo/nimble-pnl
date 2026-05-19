import { describe, it, expect } from 'vitest';
import {
  validateGeneratedShifts,
  getDayOfWeek,
  timeToMinutes,
  shiftsOverlap,
  shiftsConflict,
  withinWindow,
  type GeneratedShift,
  type ValidationContext,
  type AvailabilitySlot,
  type DropCode,
} from '../../supabase/functions/_shared/schedule-validator';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeAvailability(): Map<string, AvailabilitySlot> {
  const map = new Map<string, AvailabilitySlot>();
  // emp-1 available Monday (day 1), no time restriction
  map.set('emp-1:1', { isAvailable: true, startTime: null, endTime: null });
  // emp-2 available Monday and Tuesday (days 1 and 2)
  map.set('emp-2:1', { isAvailable: true, startTime: null, endTime: null });
  map.set('emp-2:2', { isAvailable: true, startTime: null, endTime: null });
  // emp-3 available Monday 10:00-18:00
  map.set('emp-3:1', { isAvailable: true, startTime: '10:00:00', endTime: '18:00:00' });
  return map;
}

function makeContext(overrides?: Partial<ValidationContext>): ValidationContext {
  return {
    employeeIds: new Set(['emp-1', 'emp-2', 'emp-3']),
    employeePositions: new Map([
      ['emp-1', 'server'],
      ['emp-2', 'cook'],
      ['emp-3', 'server'],
    ]),
    templateIds: new Set(['tmpl-1', 'tmpl-2']),
    availability: makeAvailability(),
    excludedEmployeeIds: new Set(),
    existingShifts: [],
    ...overrides,
  };
}

function makeShift(overrides?: Partial<GeneratedShift>): GeneratedShift {
  return {
    employee_id: 'emp-1',
    template_id: 'tmpl-1',
    day: '2026-04-13', // Monday (April 13, 2026 is a Monday)
    start_time: '10:00:00',
    end_time: '16:00:00',
    position: 'server',
    ...overrides,
  };
}

// ─── Helper Function Tests ────────────────────────────────────────────────────

describe('getDayOfWeek', () => {
  it('returns 1 for a Monday', () => {
    expect(getDayOfWeek('2026-04-13')).toBe(1); // 2026-04-13 is a Monday
  });

  it('returns 0 for a Sunday', () => {
    expect(getDayOfWeek('2026-04-12')).toBe(0); // 2026-04-12 is a Sunday
  });
});

describe('timeToMinutes', () => {
  it('converts HH:MM:SS to total minutes', () => {
    expect(timeToMinutes('10:00:00')).toBe(600);
    expect(timeToMinutes('00:30:00')).toBe(30);
    expect(timeToMinutes('23:59:59')).toBe(1439);
  });
});

describe('shiftsOverlap', () => {
  it('detects overlapping shifts', () => {
    const a = makeShift({ start_time: '10:00:00', end_time: '16:00:00' });
    const b = makeShift({ start_time: '14:00:00', end_time: '20:00:00' });
    expect(shiftsOverlap(a, b)).toBe(true);
  });

  it('does not flag non-overlapping shifts as overlapping', () => {
    const a = makeShift({ start_time: '06:00:00', end_time: '14:00:00' });
    const b = makeShift({ start_time: '14:00:00', end_time: '22:00:00' });
    expect(shiftsOverlap(a, b)).toBe(false);
  });
});

// ─── validateGeneratedShifts Tests ───────────────────────────────────────────

describe('validateGeneratedShifts', () => {
  it('accepts valid shifts', () => {
    const ctx = makeContext();
    const shift = makeShift();
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.valid[0]).toEqual(shift);
  });

  it('drops shifts with unknown employee_id', () => {
    const ctx = makeContext();
    const shift = makeShift({ employee_id: 'emp-unknown' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('UNKNOWN_EMPLOYEE');
  });

  it('drops shifts with unknown template_id', () => {
    const ctx = makeContext();
    const shift = makeShift({ template_id: 'tmpl-unknown' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('UNKNOWN_TEMPLATE');
  });

  it('drops shifts where employee position does not match', () => {
    const ctx = makeContext();
    // emp-1 is a server, but shift requests cook
    const shift = makeShift({ position: 'cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('POSITION_MISMATCH');
  });

  it('drops shifts where employee is not available on that day', () => {
    const ctx = makeContext();
    // emp-1 is only available Monday; 2026-04-14 is Tuesday
    const shift = makeShift({ day: '2026-04-14' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('UNAVAILABLE_DAY');
  });

  it('drops shifts outside availability time window', () => {
    const ctx = makeContext();
    // emp-3 is available Monday 10:00-18:00; shift goes 08:00-14:00 (starts before window)
    const shift = makeShift({
      employee_id: 'emp-3',
      day: '2026-04-13', // Monday
      start_time: '08:00:00',
      end_time: '14:00:00',
      position: 'server',
    });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');
  });

  it('drops double-booked shifts (same employee, overlapping times)', () => {
    const ctx = makeContext();
    const shift1 = makeShift({ start_time: '10:00:00', end_time: '16:00:00' });
    const shift2 = makeShift({ start_time: '14:00:00', end_time: '20:00:00' });
    const result = validateGeneratedShifts([shift1, shift2], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');
  });

  it('drops shifts for excluded employees', () => {
    const ctx = makeContext({ excludedEmployeeIds: new Set(['emp-1']) });
    const shift = makeShift();
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('EXCLUDED');
  });

  it('drops shifts that overlap with existing shifts', () => {
    const existingShift = makeShift({ start_time: '10:00:00', end_time: '16:00:00' });
    const ctx = makeContext({ existingShifts: [existingShift] });
    // New AI-generated shift overlaps with existing
    const shift = makeShift({ start_time: '14:00:00', end_time: '20:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');
  });

  it('allows two non-overlapping shifts for same employee on same day', () => {
    const ctx = makeContext();
    // emp-1 is available Monday with no time restriction
    const shift1 = makeShift({ start_time: '08:00:00', end_time: '12:00:00' });
    const shift2 = makeShift({ template_id: 'tmpl-2', start_time: '14:00:00', end_time: '18:00:00' });
    const result = validateGeneratedShifts([shift1, shift2], ctx);
    expect(result.valid).toHaveLength(2);
    expect(result.dropped).toHaveLength(0);
  });
});

// ─── Position Normalization Tests ───────────────────────────────────────────

describe('validateGeneratedShifts — position normalization', () => {
  it('matches "Line Cook" employee with "line cook" shift (case-insensitive)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Line Cook']]),
    });
    const shift = makeShift({ position: 'line cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Cook " (trailing space) employee with "Cook" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Cook ']]),
    });
    const shift = makeShift({ position: 'Cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Servers" (plural) employee with "server" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Servers']]),
    });
    const shift = makeShift({ position: 'server' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves "Hostess" (ends in ss, does not strip)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Hostess']]),
    });
    const shift = makeShift({ position: 'Hostess' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves short stems like "Bus" (stem length <= 4)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Bus']]),
    });
    const shift = makeShift({ position: 'Bus' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });
});

// ─── Overnight Window & Overlap Tests ────────────────────────────────────────

describe('shiftsOverlap — overnight handling', () => {
  it('detects overlap between 22:00-02:00 and 01:00-05:00', () => {
    const a = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ start_time: '01:00:00', end_time: '05:00:00' });
    expect(shiftsOverlap(a, b)).toBe(true);
  });

  it('does not flag 22:00-02:00 and 05:00-12:00 as overlapping', () => {
    const a = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ start_time: '05:00:00', end_time: '12:00:00' });
    expect(shiftsOverlap(a, b)).toBe(false);
  });
});

describe('shiftsConflict — day-aware overlap', () => {
  it('flags Mon 22:00-02:00 vs Tue 00:00-06:00 as conflict (overnight spillover)', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ day: '2026-04-14', start_time: '00:00:00', end_time: '06:00:00' });
    expect(shiftsConflict(a, b)).toBe(true);
    expect(shiftsConflict(b, a)).toBe(true); // symmetric
  });

  it('flags Tue 22:00-04:00 (overnight) vs Wed 03:00-09:00 as conflict', () => {
    const a = makeShift({ day: '2026-04-14', start_time: '22:00:00', end_time: '04:00:00' });
    const b = makeShift({ day: '2026-04-15', start_time: '03:00:00', end_time: '09:00:00' });
    expect(shiftsConflict(a, b)).toBe(true);
  });

  it('does NOT flag Mon 22:00-02:00 vs Tue 02:30-08:00 (overnight ends before next starts)', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ day: '2026-04-14', start_time: '02:30:00', end_time: '08:00:00' });
    expect(shiftsConflict(a, b)).toBe(false);
  });

  it('does NOT flag two normal day shifts on consecutive days', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '10:00:00', end_time: '18:00:00' });
    const b = makeShift({ day: '2026-04-14', start_time: '10:00:00', end_time: '18:00:00' });
    expect(shiftsConflict(a, b)).toBe(false);
  });

  it('does NOT flag two overnight shifts on consecutive days (back-to-back nights)', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ day: '2026-04-14', start_time: '22:00:00', end_time: '02:00:00' });
    expect(shiftsConflict(a, b)).toBe(false);
  });

  it('does NOT flag shifts >1 day apart', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '22:00:00', end_time: '02:00:00' });
    const b = makeShift({ day: '2026-04-15', start_time: '00:00:00', end_time: '06:00:00' });
    expect(shiftsConflict(a, b)).toBe(false);
  });

  it('delegates to shiftsOverlap for same-day shifts', () => {
    const a = makeShift({ day: '2026-04-13', start_time: '10:00:00', end_time: '16:00:00' });
    const b = makeShift({ day: '2026-04-13', start_time: '14:00:00', end_time: '20:00:00' });
    expect(shiftsConflict(a, b)).toBe(true);
  });
});

describe('validateGeneratedShifts — cross-day double-booking', () => {
  it('drops AI shift Tue 00:00-06:00 when existing shift Mon 22:00-02:00 is overnight', () => {
    // emp-2 is available both Monday (day 1) and Tuesday (day 2).
    // Existing shift is Monday 22:00 → Tuesday 02:00 (overnight).
    // New AI-generated shift Tuesday 00:00-06:00 would collide.
    const existing = makeShift({
      employee_id: 'emp-2',
      position: 'cook',
      day: '2026-04-13',
      start_time: '22:00:00',
      end_time: '02:00:00',
    });
    const ctx = makeContext({ existingShifts: [existing] });
    const aiShift = makeShift({
      employee_id: 'emp-2',
      position: 'cook',
      day: '2026-04-14',
      start_time: '00:00:00',
      end_time: '06:00:00',
    });
    const result = validateGeneratedShifts([aiShift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');
  });

  it('drops second AI shift Tue 00:00-06:00 when first AI shift Mon 22:00-02:00 is already valid', () => {
    const ctx = makeContext();
    const shift1 = makeShift({
      employee_id: 'emp-2',
      position: 'cook',
      day: '2026-04-13',
      start_time: '22:00:00',
      end_time: '02:00:00',
    });
    const shift2 = makeShift({
      employee_id: 'emp-2',
      position: 'cook',
      day: '2026-04-14',
      start_time: '00:00:00',
      end_time: '06:00:00',
    });
    const result = validateGeneratedShifts([shift1, shift2], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].day).toBe('2026-04-13');
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DOUBLE_BOOKING');
  });
});

describe('validateGeneratedShifts — overnight availability window', () => {
  it('accepts shift 22:00-02:00 within window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('rejects shift 12:00-18:00 against overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '12:00:00', end_time: '18:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');
  });

  it('rejects overnight shift 22:00-02:00 against normal window 08:00-23:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '08:00:00', endTime: '23:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '22:00:00', end_time: '02:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped[0].code).toBe('OUTSIDE_WINDOW');
  });

  it('accepts evening half 20:00-23:30 of overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '20:00:00', end_time: '23:30:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('accepts morning half 02:00-05:00 of overnight window 18:00-06:00', () => {
    const ctx = makeContext({
      availability: new Map([
        ['emp-1:1', { isAvailable: true, startTime: '18:00:00', endTime: '06:00:00' }],
      ]),
    });
    const shift = makeShift({ start_time: '02:00:00', end_time: '05:00:00' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });
});
