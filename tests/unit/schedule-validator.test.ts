import { describe, it, expect } from 'vitest';
import {
  validateGeneratedShifts,
  getDayOfWeek,
  timeToMinutes,
  shiftsOverlap,
  type GeneratedShift,
  type ValidationContext,
  type AvailabilitySlot,
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
    lockedShiftIds: new Set(),
    excludedEmployeeIds: new Set(),
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
    expect(result.dropped[0].reason).toMatch(/employee/i);
  });

  it('drops shifts with unknown template_id', () => {
    const ctx = makeContext();
    const shift = makeShift({ template_id: 'tmpl-unknown' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/template/i);
  });

  it('drops shifts where employee position does not match', () => {
    const ctx = makeContext();
    // emp-1 is a server, but shift requests cook
    const shift = makeShift({ position: 'cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/position/i);
  });

  it('drops shifts where employee is not available on that day', () => {
    const ctx = makeContext();
    // emp-1 is only available Monday; 2026-04-14 is Tuesday
    const shift = makeShift({ day: '2026-04-14' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/available/i);
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
    expect(result.dropped[0].reason).toMatch(/time window|availability window/i);
  });

  it('drops double-booked shifts (same employee, overlapping times)', () => {
    const ctx = makeContext();
    const shift1 = makeShift({ start_time: '10:00:00', end_time: '16:00:00' });
    const shift2 = makeShift({ start_time: '14:00:00', end_time: '20:00:00' });
    const result = validateGeneratedShifts([shift1, shift2], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/double.book|overlap/i);
  });

  it('drops shifts for excluded employees', () => {
    const ctx = makeContext({ excludedEmployeeIds: new Set(['emp-1']) });
    const shift = makeShift();
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].reason).toMatch(/excluded/i);
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
