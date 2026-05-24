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

// Bug I: ValidationContext.employees promoted from Set + parallel Map.
// `emp()` factory builds one entry; default cap is adult 40h so existing
// suites that don't care about hour caps behave the same.
function emp(
  id: string,
  position = 'server',
  is_minor = false,
  max_weekly_hours = 40,
): readonly [string, { position: string; is_minor: boolean; max_weekly_hours: number }] {
  return [id, { position, is_minor, max_weekly_hours }] as const;
}

function makeContext(overrides?: Partial<ValidationContext>): ValidationContext {
  return {
    employees: new Map([
      emp('emp-1', 'server'),
      emp('emp-2', 'cook'),
      emp('emp-3', 'server'),
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
      employees: new Map([emp('emp-2', 'cook')]),
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
      employees: new Map([emp('emp-2', 'cook')]),
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
      employees: new Map([emp('mgr-1', 'Manager')]),
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
      employees: new Map([
        emp('emp-1', 'Line Cook'),
        emp('emp-2', 'cook'),
        emp('emp-3', 'server'),
      ]),
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
      employees: new Map([
        emp('emp-1', 'Cook '),
        emp('emp-2', 'cook'),
        emp('emp-3', 'server'),
      ]),
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
      employees: new Map([
        emp('emp-1', 'Servers'),
        emp('emp-2', 'cook'),
        emp('emp-3', 'server'),
      ]),
      // Default tmpl-1.position = 'server', which normalizes-matches 'Servers'.
    });
    const shift = makeShift({ position: 'server' });
    const result = validateGeneratedShifts([shift], ctx);
    expect(result.valid).toHaveLength(1);
  });

  it('preserves "Hostess" (ends in ss, does not strip)', () => {
    const ctx = makeContext({
      employees: new Map([
        emp('emp-1', 'Hostess'),
        emp('emp-2', 'cook'),
        emp('emp-3', 'server'),
      ]),
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
      employees: new Map([
        emp('emp-1', 'Bus'),
        emp('emp-2', 'cook'),
        emp('emp-3', 'server'),
      ]),
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

// ─── Bug I: hour caps + consecutive days ────────────────────────────────────
//
// The 2026-05-23 production symptom: 9 employees got 45.5-48.5h each
// across 7 consecutive days while 14 PT employees got zero shifts. The
// LLM prompt's soft Rule 11 ("target 35-40h") was honored as advisory
// while the HARD fill-every-slot rule won.
//
// These tests lock the validator backstop: even if the prompt-side rules
// fail (different LLM, longer prompt, etc.), the validator drops any
// shift that would push an employee over their weekly cap or onto a 6th
// consecutive day.
//
// Helpers below build a Server-only context with one employee available
// every day, then enumerate 7 daily 6.5h shifts (39h total in the first
// 6 days). Each test tweaks one variable to verify the new step's
// dispatch and bookkeeping.

describe('validateGeneratedShifts — hour caps and consecutive days', () => {
  // Mon 2026-06-08 through Sun 2026-06-14 (Bug I production week)
  const WEEK_DAYS = [
    '2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11',
    '2026-06-12', '2026-06-13', '2026-06-14',
  ];

  function makeAllWeekAvailability(empId: string): Map<string, AvailabilitySlot> {
    const map = new Map<string, AvailabilitySlot>();
    // 0=Sun..6=Sat
    for (let dow = 0; dow < 7; dow++) {
      map.set(`${empId}:${dow}`, { isAvailable: true, startTime: null, endTime: null });
    }
    return map;
  }

  function dailyShifts(opts: {
    employee_id: string;
    template_id?: string;
    position?: string;
    start_time?: string;
    end_time?: string;
    days?: string[];
  }): GeneratedShift[] {
    const days = opts.days ?? WEEK_DAYS;
    return days.map((day) => ({
      employee_id: opts.employee_id,
      template_id: opts.template_id ?? 'tmpl-1',
      day,
      start_time: opts.start_time ?? '10:00:00',
      end_time: opts.end_time ?? '16:30:00', // 6.5h
      position: opts.position ?? 'server',
    }));
  }

  it('drops 7th 6.5h shift when employee would exceed adult 40h cap', () => {
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', /* is_minor */ false, /* cap */ 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    const shifts = dailyShifts({ employee_id: 'emp-1' });
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(6); // 6 × 6.5h = 39h
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
  });

  it('drops 4th shift for under-16 minor (18h cap)', () => {
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', /* is_minor */ true, /* cap */ 18)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    // 3 × 6h shifts = 18h; 4th would push to 24h.
    const shifts = dailyShifts({
      employee_id: 'emp-1',
      end_time: '16:00:00', // 6h
      days: WEEK_DAYS.slice(0, 4),
    });
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(3);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('MINOR_HOURS_EXCEEDED');
  });

  it('16-17yo minor (40h cap) dispatches HOURS_EXCEED_WEEKLY_CAP, NOT MINOR_HOURS_EXCEEDED', () => {
    // Dispatch rule: MINOR_HOURS_EXCEEDED fires ONLY when cap === 18.
    // A 17yo with the 40h cap that exceeds it gets the adult code.
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', /* is_minor */ true, /* cap */ 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    const shifts = dailyShifts({ employee_id: 'emp-1' }); // 7 × 6.5h
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(6);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
  });

  it('drops 6th consecutive day even when employee is well under hour cap', () => {
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    // 6 × 4h shifts = 24h (under 40h cap), but 6 consecutive days
    // violates Rule 12.
    const shifts = dailyShifts({
      employee_id: 'emp-1',
      end_time: '14:00:00', // 4h
      days: WEEK_DAYS.slice(0, 6), // Mon-Sat
    });
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(5); // Mon-Fri
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('CONSECUTIVE_DAYS_EXCEEDED');
    expect(result.dropped[0].shift.day).toBe('2026-06-13'); // Saturday
  });

  it('accepts Mon-Fri + Sun (gap on Saturday breaks the run)', () => {
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    // Mon, Tue, Wed, Thu, Fri, (skip Sat), Sun — longest run is 5.
    const shifts = dailyShifts({
      employee_id: 'emp-1',
      end_time: '14:00:00', // 4h
      days: ['2026-06-08','2026-06-09','2026-06-10','2026-06-11','2026-06-12','2026-06-14'],
    });
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(6);
    expect(result.dropped).toHaveLength(0);
  });

  it('locked shifts seed the hour counter — candidate drops when sum would exceed cap', () => {
    // Locked shifts put the employee at 35h already. A new 7h candidate
    // (total 42h) must drop.
    const lockedShifts: GeneratedShift[] = [
      // 5 × 7h locked = 35h on Mon-Fri
      ...WEEK_DAYS.slice(0, 5).map((day) => ({
        employee_id: 'emp-1',
        template_id: 'tmpl-1',
        day,
        start_time: '10:00:00',
        end_time: '17:00:00', // 7h
        position: 'server',
      })),
    ];
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
      existingShifts: lockedShifts,
    });
    const candidate = makeShift({
      employee_id: 'emp-1',
      day: '2026-06-13', // Saturday — not in locked
      start_time: '10:00:00',
      end_time: '17:00:00',
      position: 'server',
    });
    const result = validateGeneratedShifts([candidate], ctx);

    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
  });

  it('locked shift already over cap is never retroactively dropped; only new candidates drop', () => {
    // Locked = 41h (over 40h cap). Validator keeps the lock untouched
    // — it never modifies existingShifts — but any new candidate for
    // the same employee drops because the counter is already past cap.
    const lockedShifts: GeneratedShift[] = [
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-08',
        start_time: '08:00:00', end_time: '20:00:00', position: 'server' }, // 12h
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-09',
        start_time: '08:00:00', end_time: '20:00:00', position: 'server' }, // 12h
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-10',
        start_time: '08:00:00', end_time: '17:00:00', position: 'server' }, // 9h
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-11',
        start_time: '08:00:00', end_time: '16:00:00', position: 'server' }, // 8h
    ]; // 41h total
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
      existingShifts: lockedShifts,
    });
    const candidate = makeShift({
      employee_id: 'emp-1',
      day: '2026-06-12',
      start_time: '10:00:00',
      end_time: '14:00:00', // 4h
      position: 'server',
    });
    const result = validateGeneratedShifts([candidate], ctx);

    expect(result.valid).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
    expect(result.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
  });

  it('duplicate day in existingShifts (open + close on same Monday) does not collapse streak math', () => {
    // Two locked shifts on the same Monday → dedup means Monday counts
    // once, not twice as a zero-diff "gap." Subsequent Tue/Wed/Thu/Fri
    // candidates all accept (run = 5, not 6).
    const lockedShifts: GeneratedShift[] = [
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-08',
        start_time: '08:00:00', end_time: '12:00:00', position: 'server' }, // 4h open
      { employee_id: 'emp-1', template_id: 'tmpl-1', day: '2026-06-08',
        start_time: '13:00:00', end_time: '17:00:00', position: 'server' }, // 4h close
    ];
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
      existingShifts: lockedShifts,
    });
    // 4 new candidates on Tue-Fri (Mon already locked).
    const shifts = dailyShifts({
      employee_id: 'emp-1',
      end_time: '14:00:00', // 4h each
      days: ['2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12'],
    });
    const result = validateGeneratedShifts(shifts, ctx);

    expect(result.valid).toHaveLength(4);
    expect(result.dropped).toHaveLength(0);
  });

  it('overnight shift counts as one day, not two (4h hours, not 24h)', () => {
    // 22:00-02:00 on Monday = 4h, NOT 24h. The shift's `day` field is the
    // calendar day it nominally starts on; the validator must use the
    // time-diff formula (with overnight handling), not (next-day - day).
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    // 9 overnight 4h shifts = 36h. If the validator wrongly counted
    // each as 24h, we'd drop after the 2nd (48h > 40h).
    const shifts = WEEK_DAYS.slice(0, 7).map((day) => ({
      employee_id: 'emp-1',
      template_id: 'tmpl-1',
      day,
      start_time: '22:00:00',
      end_time: '02:00:00',
      position: 'server',
    }));
    // 7 days at 4h = 28h. Should all fit under 40h. But 7 consecutive
    // days violates Rule 12 → drop on day 6.
    const result = validateGeneratedShifts(shifts, ctx);

    // 5 accept (consecutive-day rule kicks in on day 6), 2 drop with
    // CONSECUTIVE_DAYS_EXCEEDED — proves hour cap did NOT drop them
    // (which would imply 24h-per-shift miscounting).
    expect(result.valid).toHaveLength(5);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped.every((d) => d.code === 'CONSECUTIVE_DAYS_EXCEEDED')).toBe(true);
  });

  it('produces same valid set regardless of input order (sorted by day/start/employee/template)', () => {
    // Bug I requires deterministic "first 5 wins" — sort key (day,
    // start_time, employee_id, template_id) so re-runs on identical
    // inputs produce identical output.
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    const shifts = dailyShifts({ employee_id: 'emp-1' }); // 7 × 6.5h = 45.5h
    // Shuffle by reversing — should yield identical valid set after sort.
    const reversed = [...shifts].reverse();

    const r1 = validateGeneratedShifts(shifts, ctx);
    const r2 = validateGeneratedShifts(reversed, ctx);

    const days1 = r1.valid.map((s) => s.day).sort();
    const days2 = r2.valid.map((s) => s.day).sort();
    expect(days2).toEqual(days1);
    expect(r1.valid).toHaveLength(6);
    expect(r2.valid).toHaveLength(6);
    expect(r1.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
    expect(r2.dropped[0].code).toBe('HOURS_EXCEED_WEEKLY_CAP');
  });

  it('counts consecutive days correctly across DST spring-forward (March 8 2026)', () => {
    // Mar 2-8 2026; Mar 8 is the US DST spring-forward day. UTC-anchored
    // math means the consecutive-day count is 7, not 6 (no false gap).
    const dstWeek = [
      '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05',
      '2026-03-06', '2026-03-07', '2026-03-08',
    ];
    const ctx = makeContext({
      employees: new Map([emp('emp-1', 'server', false, 40)]),
      availability: makeAllWeekAvailability('emp-1'),
    });
    const shifts = dailyShifts({
      employee_id: 'emp-1',
      end_time: '14:00:00', // 4h each
      days: dstWeek,
    });
    const result = validateGeneratedShifts(shifts, ctx);

    // 5 accept Mon-Fri; 2 drop (Sat, Sun) with consecutive-days code.
    // If DST created a false gap, we'd see 6 valid (no drop on Sat).
    expect(result.valid).toHaveLength(5);
    expect(result.dropped).toHaveLength(2);
    expect(result.dropped.every((d) => d.code === 'CONSECUTIVE_DAYS_EXCEEDED')).toBe(true);
  });
});
