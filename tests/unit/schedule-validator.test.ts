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
    // Default fixtures use templates active on every day of the week and the
    // 'server' position so existing suites that don't care about active-days
    // or template position continue to behave the same. New
    // DAY_NOT_IN_TEMPLATE / POSITION_MISMATCH tests override these explicitly.
    templates: new Map([
      ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
      ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
    ]),
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

  // ── Bug C regression: validator must enforce template.days ──────────────
  // Production restaurant 7c0c76e3: weekend-only templates (days [0,5,6])
  // ended up assigned on Monday because the validator never checked the
  // shift's day-of-week against the template's active days. Two of four
  // shifts persisted incorrectly on Jun 1 (Monday).

  it('drops a shift whose day-of-week is not in the template active days', () => {
    const ctx = makeContext({
      employeeIds: new Set(['emp-2']),
      employeePositions: new Map([['emp-2', 'cook']]),
      templates: new Map([
        // Weekend-only template (Sun, Fri, Sat)
        ['weekend-close', { days: [0, 5, 6], position: 'cook' }],
      ]),
      availability: new Map([
        ['emp-2:1', { isAvailable: true, startTime: null, endTime: null }],
      ]),
    });
    const shift = makeShift({
      employee_id: 'emp-2',
      template_id: 'weekend-close',
      day: '2026-04-13', // Monday (dow=1) — NOT in [0, 5, 6]
      position: 'cook',
    });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('DAY_NOT_IN_TEMPLATE');
  });

  it('allows a shift whose day-of-week IS in the template active days', () => {
    const ctx = makeContext({
      employeeIds: new Set(['emp-2']),
      employeePositions: new Map([['emp-2', 'cook']]),
      templates: new Map([
        ['weekday-close', { days: [1, 2, 3, 4, 5], position: 'cook' }],
      ]),
      availability: new Map([
        ['emp-2:1', { isAvailable: true, startTime: null, endTime: null }],
      ]),
    });
    const shift = makeShift({
      employee_id: 'emp-2',
      template_id: 'weekday-close',
      day: '2026-04-13', // Monday (dow=1) — IS in [1, 2, 3, 4, 5]
      position: 'cook',
    });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops shifts where shift.position does not match template.position', () => {
    const ctx = makeContext();
    // emp-1 is a server on tmpl-1 (server), but shift.position requests cook —
    // the LLM-emitted label disagrees with the template's required position.
    const shift = makeShift({ position: 'cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('POSITION_MISMATCH');
  });

  // ── Bug E regression: validator must enforce template.position, not just
  //    employee.position vs shift.position. Production restaurant 7c0c76e3:
  //    Managers (Alejandra Perez, Jose Delgado) were assigned to Server
  //    templates (Open-week-csc, Close-week-csc). The LLM emitted
  //    shift.position="Manager" matching employee.position="Manager", and
  //    the legacy check passed because it only compared those two
  //    LLM-controlled fields. Result: 3/2 and 4/3 over-fills.
  it('drops a Manager assigned to a Server template even when shift.position matches the employee', () => {
    const ctx = makeContext({
      employeeIds: new Set(['mgr-1']),
      employeePositions: new Map([['mgr-1', 'Manager']]),
      availability: new Map([
        ['mgr-1:1', { isAvailable: true, startTime: null, endTime: null }],
      ]),
      // tmpl-1 default = 'server'
    });
    // The LLM's bypass: shift.position emitted as the manager's own position
    // so the legacy `shift.position vs employee.position` check passed.
    const shift = makeShift({
      employee_id: 'mgr-1',
      position: 'Manager',
    });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('POSITION_MISMATCH');
    expect(result.dropped[0].message).toContain('Manager');
    expect(result.dropped[0].message).toContain('server');
  });

  it('accepts a Server employee on a Server template (Bug E regression — happy path)', () => {
    const ctx = makeContext();
    // emp-1 is a server on tmpl-1 (server). All three labels match.
    const shift = makeShift({ employee_id: 'emp-1', position: 'server' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
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
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'line cook' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
      ]),
    });
    const shift = makeShift({ position: 'line cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Cook " (trailing space) employee with "Cook" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Cook ']]),
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'Cook' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
      ]),
    });
    const shift = makeShift({ position: 'Cook' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('matches "Servers" (plural) employee with "server" shift', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Servers']]),
      // Default tmpl-1.position = 'server', which normalizes-matches 'Servers'.
    });
    const shift = makeShift({ position: 'server' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves "Hostess" (ends in ss, does not strip)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Hostess']]),
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'Hostess' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
      ]),
    });
    const shift = makeShift({ position: 'Hostess' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves short stems like "Bus" (stem length <= 4)', () => {
    const ctx = makeContext({
      employeePositions: new Map([['emp-1', 'Bus']]),
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'Bus' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'server' }],
      ]),
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
    const ctx = makeContext({
      existingShifts: [existing],
      // Override defaults so emp-2 (cook) passes the template-position check
      // and we get to the overlap check we're actually testing.
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'cook' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'cook' }],
      ]),
    });
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
    const ctx = makeContext({
      templates: new Map([
        ['tmpl-1', { days: [0, 1, 2, 3, 4, 5, 6], position: 'cook' }],
        ['tmpl-2', { days: [0, 1, 2, 3, 4, 5, 6], position: 'cook' }],
      ]),
    });
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
