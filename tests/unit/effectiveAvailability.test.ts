import { describe, it, expect } from 'vitest';
import {
  computeEffectiveAvailability,
  availabilityColorClasses,
  availabilityLabel,
  shiftOutsideAvailability,
  EffectiveSlot,
  EffectiveAvailability,
} from '@/lib/effectiveAvailability';
import { EmployeeAvailability, AvailabilityException } from '@/types/scheduling';

const makeAvailability = (
  overrides: Partial<EmployeeAvailability> & { employee_id: string; day_of_week: number }
): EmployeeAvailability => ({
  id: crypto.randomUUID(),
  restaurant_id: 'rest-1',
  start_time: '09:00:00',
  end_time: '17:00:00',
  is_available: true,
  notes: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const makeException = (
  overrides: Partial<AvailabilityException> & { employee_id: string; date: string }
): AvailabilityException => ({
  id: crypto.randomUUID(),
  restaurant_id: 'rest-1',
  is_available: false,
  reason: '',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('computeEffectiveAvailability', () => {
  // Week of Apr 6 (Mon) to Apr 12 (Sun), 2026
  const weekStart = new Date(2026, 3, 6); // Mon Apr 6
  const employeeIds = ['emp-1'];

  it('returns not-set when employee has no availability or exceptions', () => {
    const result = computeEffectiveAvailability([], [], weekStart, employeeIds);
    const monday = result.get('emp-1')?.get(1); // day_of_week 1 = Monday
    expect(monday).toEqual({ type: 'not-set', slots: [] });
  });

  it('returns recurring availability when no exception exists', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 1 })];
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds);
    const monday = result.get('emp-1')?.get(1);
    expect(monday?.type).toBe('recurring');
    expect(monday?.slots).toHaveLength(1);
    expect(monday?.slots[0].startTime).toBe('09:00:00');
    expect(monday?.slots[0].endTime).toBe('17:00:00');
    expect(monday?.slots[0].isAvailable).toBe(true);
  });

  it('exception overrides recurring availability for that date', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 1 })];
    const exceptions = [
      makeException({
        employee_id: 'emp-1',
        date: '2026-04-06', // Monday of this week
        is_available: false,
        reason: 'Doctor appt',
      }),
    ];
    const result = computeEffectiveAvailability(avail, exceptions, weekStart, employeeIds);
    const monday = result.get('emp-1')?.get(1);
    expect(monday?.type).toBe('exception');
    expect(monday?.slots).toHaveLength(1);
    expect(monday?.slots[0].isAvailable).toBe(false);
    expect(monday?.slots[0].reason).toBe('Doctor appt');
  });

  it('handles split shifts (multiple entries for same day)', () => {
    const avail = [
      makeAvailability({ employee_id: 'emp-1', day_of_week: 1, start_time: '09:00:00', end_time: '12:00:00' }),
      makeAvailability({ employee_id: 'emp-1', day_of_week: 1, start_time: '16:00:00', end_time: '22:00:00' }),
    ];
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds);
    const monday = result.get('emp-1')?.get(1);
    expect(monday?.type).toBe('recurring');
    expect(monday?.slots).toHaveLength(2);
  });

  it('exception outside displayed week is ignored', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 1 })];
    const exceptions = [
      makeException({
        employee_id: 'emp-1',
        date: '2026-04-13', // Next Monday, outside this week
        is_available: false,
      }),
    ];
    const result = computeEffectiveAvailability(avail, exceptions, weekStart, employeeIds);
    const monday = result.get('emp-1')?.get(1);
    expect(monday?.type).toBe('recurring');
  });

  it('recurring unavailable (is_available=false) returns unavailable slot', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 0, is_available: false })];
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds);
    const sunday = result.get('emp-1')?.get(0);
    expect(sunday?.type).toBe('recurring');
    expect(sunday?.slots[0].isAvailable).toBe(false);
  });

  it('multiple employees are handled independently', () => {
    const avail = [
      makeAvailability({ employee_id: 'emp-1', day_of_week: 1, start_time: '09:00:00', end_time: '17:00:00' }),
      makeAvailability({ employee_id: 'emp-2', day_of_week: 1, start_time: '06:00:00', end_time: '14:00:00' }),
    ];
    const result = computeEffectiveAvailability(avail, [], weekStart, ['emp-1', 'emp-2']);
    expect(result.get('emp-1')?.get(1)?.slots[0].startTime).toBe('09:00:00');
    expect(result.get('emp-2')?.get(1)?.slots[0].startTime).toBe('06:00:00');
  });
});

const avail = (
  isAvailable: boolean,
  start: string | null,
  end: string | null,
  type: EffectiveAvailability['type'] = 'recurring',
): EffectiveAvailability => ({
  type,
  slots:
    type === 'not-set'
      ? []
      : [{ isAvailable, startTime: start, endTime: end, sourceRecord: {} as never }],
});

describe('availabilityColorClasses', () => {
  it('emerald when available, amber for unavailable exception, red for recurring off, neutral when not-set', () => {
    expect(availabilityColorClasses(avail(true, '18:00:00', '02:00:00')).bg).toContain('emerald');
    expect(availabilityColorClasses(avail(false, null, null, 'exception')).bg).toContain('amber');
    expect(availabilityColorClasses(avail(false, null, null, 'recurring')).bg).toContain('red');
    expect(availabilityColorClasses(avail(false, null, null, 'not-set')).bg).toContain('muted');
  });
});

describe('availabilityLabel', () => {
  it('formats an available window in restaurant-local time', () => {
    // 18:00 UTC in America/New_York (EDT) is 2:00 PM on 2027-07-13.
    const label = availabilityLabel(
      avail(true, '18:00:00', '02:30:00'),
      'America/New_York',
      new Date(2027, 6, 13),
    );
    expect(label).toMatch(/Available 2:00 PM/);
  });
  it('labels unavailable and not-set', () => {
    expect(availabilityLabel(avail(false, null, null, 'recurring'), 'UTC', new Date(2027, 6, 13))).toBe(
      'Unavailable',
    );
    expect(
      availabilityLabel(avail(false, null, null, 'not-set'), 'UTC', new Date(2027, 6, 13)),
    ).toBe('No availability set');
  });
});

describe('shiftOutsideAvailability (TZ-portable)', () => {
  // Employee available 2:00 PM-10:30 PM local (stored UTC-clock, derived below).
  const nyAvail = avail(true, '18:00:00', '02:30:00'); // EDT: 2:00 PM - 10:30 PM
  it('is false when the shift is within the window', () => {
    expect(
      shiftOutsideAvailability(
        nyAvail,
        undefined,
        new Date('2027-07-13T21:00:00Z'),
        new Date('2027-07-14T01:00:00Z'),
        'America/New_York',
        new Date(2027, 6, 13),
      ),
    ).toBe(false); // 5-9 PM EDT
  });
  it('is true when the shift starts before the window', () => {
    expect(
      shiftOutsideAvailability(
        nyAvail,
        undefined,
        new Date('2027-07-13T15:00:00Z'),
        new Date('2027-07-13T17:00:00Z'),
        'America/New_York',
        new Date(2027, 6, 13),
      ),
    ).toBe(true); // 11 AM-1 PM EDT
  });
});
