import { describe, it, expect } from 'vitest';
import {
  computeEffectiveAvailability,
  availabilityColorClasses,
  availabilityLabel,
  shiftOutsideAvailability,
  summarizeWeekAvailability,
  weekAvailabilityChipClasses,
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

  // CodeRabbit finding: split-shift (multi-slot) availability lost the
  // second window because only slots[0] was read — the same day's second
  // available window must show up too, matching TeamAvailabilityGrid's
  // ' + '-joined split-shift display convention.
  it('joins every available slot for a split-shift day', () => {
    const splitDay: EffectiveAvailability = {
      type: 'recurring',
      slots: [
        { isAvailable: true, startTime: '13:00:00', endTime: '16:00:00', sourceRecord: {} as never },
        { isAvailable: true, startTime: '20:00:00', endTime: '23:00:00', sourceRecord: {} as never },
      ],
    };
    const label = availabilityLabel(splitDay, 'UTC', new Date(2027, 6, 13));
    expect(label).toBe('Available 1:00 PM – 4:00 PM + 8:00 PM – 11:00 PM');
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

  // Codex finding: a `not-set` day (no exception, no recurring row) must
  // still check the previous local day's overnight window before deciding —
  // mirrors the RPC's 3c, which runs unconditionally, not only when 3b found
  // a same-day match/off row.
  describe('previous-day overnight window on an otherwise not-set day', () => {
    const notSetToday = avail(false, null, null, 'not-set');
    // Friday 6:00 PM - 2:00 AM EDT recurring window (stored UTC-clock 22:00-06:00).
    const fridayOvernight = avail(true, '22:00:00', '06:00:00');

    it('is false (not flagged) when the shift falls inside the carried-over window', () => {
      expect(
        shiftOutsideAvailability(
          notSetToday,
          fridayOvernight,
          new Date('2027-07-17T05:00:00Z'), // 1:00 AM EDT Saturday
          new Date('2027-07-17T05:30:00Z'), // 1:30 AM EDT Saturday
          'America/New_York',
          new Date(2027, 6, 17), // Saturday
        ),
      ).toBe(false);
    });

    it('is true (flagged) when the shift falls outside the carried-over window', () => {
      expect(
        shiftOutsideAvailability(
          notSetToday,
          fridayOvernight,
          new Date('2027-07-17T07:00:00Z'), // 3:00 AM EDT Saturday — past the 2:00 AM window end
          new Date('2027-07-17T08:00:00Z'),
          'America/New_York',
          new Date(2027, 6, 17),
        ),
      ).toBe(true);
    });

    it('stays false (unknown, not flagged) on a not-set day with no prevDay data at all', () => {
      expect(
        shiftOutsideAvailability(
          notSetToday,
          undefined,
          new Date('2027-07-17T15:00:00Z'),
          new Date('2027-07-17T16:00:00Z'),
          'America/New_York',
          new Date(2027, 6, 17),
        ),
      ).toBe(false);
    });
  });

  // Sound-logic finding: the previous local day's stored UTC-clock times must
  // be anchored to YESTERDAY's date (like the RPC's v_prev_date), not
  // today's — otherwise a DST-transition day picks the wrong UTC offset.
  // America/New_York springs forward on Sun Mar 12, 2028 (2:00 AM -> 3:00 AM).
  it('anchors the previous day\'s overnight window to yesterday\'s date across a spring-forward transition', () => {
    const notSetToday = avail(false, null, null, 'not-set');
    // Saturday Mar 11 (EST, UTC-5) recurring window, stored UTC-clock 23:00-08:00.
    // Anchored correctly (to Sat, EST): local 6:00 PM Sat - 3:00 AM Sun.
    // Anchored incorrectly (to Sun, which is EDT for these UTC instants):
    // local 7:00 PM Sat - 4:00 AM Sun — a full hour later at both ends.
    const saturdayOvernight = avail(true, '23:00:00', '08:00:00');

    // Sunday 3:15-3:30 AM EDT: inside the WRONG (today-anchored) window
    // (ends 4:00 AM) but outside the CORRECT (yesterday-anchored) window
    // (ends 3:00 AM) — so this shift must be flagged (true).
    expect(
      shiftOutsideAvailability(
        notSetToday,
        saturdayOvernight,
        new Date('2028-03-12T07:15:00Z'), // 3:15 AM EDT Sunday
        new Date('2028-03-12T07:30:00Z'), // 3:30 AM EDT Sunday
        'America/New_York',
        new Date(2028, 2, 12), // Sunday Mar 12
      ),
    ).toBe(true);
  });

  // Codex finding: a shift crossing into the next local day must also be
  // checked against that NEXT day's own hard-off data — today's window
  // extended past midnight can't paper over Saturday's own unavailable
  // exception, mirroring the RPC's per-local-date walk (block 3c's forward
  // counterpart).
  describe('next-day override on a shift crossing midnight forward', () => {
    // Friday recurring window: 6:00 PM - 2:00 AM UTC (stored as one overnight row).
    const fridayOvernight = avail(true, '18:00:00', '02:00:00');
    const saturdayUnavailableException = avail(false, null, null, 'exception');

    it('is true when the shift tail falls on a next-day hard-unavailable exception, even though Friday\'s window alone would cover it', () => {
      expect(
        shiftOutsideAvailability(
          fridayOvernight,
          undefined,
          new Date('2027-07-16T22:00:00Z'), // Fri 10:00 PM UTC
          new Date('2027-07-17T01:00:00Z'), // Sat 1:00 AM UTC
          'UTC',
          new Date(2027, 6, 16), // Friday
          saturdayUnavailableException,
        ),
      ).toBe(true);
    });

    it('is false when no next-day data is supplied (same-day-only shifts unaffected by this fix)', () => {
      expect(
        shiftOutsideAvailability(
          fridayOvernight,
          undefined,
          new Date('2027-07-16T19:00:00Z'), // Fri 7:00 PM UTC
          new Date('2027-07-16T20:00:00Z'), // Fri 8:00 PM UTC
          'UTC',
          new Date(2027, 6, 16),
        ),
      ).toBe(false);
    });

    it('is false when the next day is available and covers the shift tail', () => {
      const saturdayAvailable = avail(true, '00:00:00', '06:00:00');
      expect(
        shiftOutsideAvailability(
          fridayOvernight,
          undefined,
          new Date('2027-07-16T22:00:00Z'), // Fri 10:00 PM UTC
          new Date('2027-07-17T01:00:00Z'), // Sat 1:00 AM UTC
          'UTC',
          new Date(2027, 6, 16),
          saturdayAvailable,
        ),
      ).toBe(false);
    });
  });
});

describe('summarizeWeekAvailability', () => {
  const weekOf = (
    entries: Array<[number, boolean, EffectiveAvailability['type']?]>,
  ): Map<number, EffectiveAvailability> => {
    const map = new Map<number, EffectiveAvailability>();
    for (const [dow, isAvailable, type = 'recurring'] of entries) {
      map.set(dow, avail(isAvailable, '09:00:00', '17:00:00', type));
    }
    return map;
  };

  it('time off takes priority over everything else', () => {
    const week = weekOf([
      [1, true],
      [2, false],
    ]);
    expect(summarizeWeekAvailability(week, true)).toEqual({
      status: 'time_off',
      label: 'Time off',
    });
  });

  it('uses a custom off label when provided', () => {
    const week = weekOf([[1, true]]);
    expect(summarizeWeekAvailability(week, true, 'Vacation')).toEqual({
      status: 'time_off',
      label: 'Vacation',
    });
  });

  it('flags limited when any day is recurring-unavailable, even with other available days', () => {
    const week = weekOf([
      [1, true],
      [2, false, 'recurring'],
    ]);
    expect(summarizeWeekAvailability(week, false)).toEqual({
      status: 'limited',
      label: 'Limited availability',
    });
  });

  it('flags limited when any day is an unavailable exception', () => {
    const week = weekOf([
      [1, true],
      [3, false, 'exception'],
    ]);
    expect(summarizeWeekAvailability(week, false)).toEqual({
      status: 'limited',
      label: 'Limited availability',
    });
  });

  it('flags available when no unavailable day exists but at least one available day does', () => {
    const week = weekOf([
      [0, true],
      [4, true],
    ]);
    expect(summarizeWeekAvailability(week, false)).toEqual({
      status: 'available',
      label: 'Available',
    });
  });

  it('is unset when every day is not-set', () => {
    const week = new Map<number, EffectiveAvailability>();
    week.set(1, { type: 'not-set', slots: [] });
    week.set(2, { type: 'not-set', slots: [] });
    expect(summarizeWeekAvailability(week, false)).toEqual({
      status: 'unset',
      label: 'Availability not set',
    });
  });

  it('is unset for an empty map', () => {
    expect(summarizeWeekAvailability(new Map(), false)).toEqual({
      status: 'unset',
      label: 'Availability not set',
    });
  });

  it('is unset when the week is undefined (loading/error state)', () => {
    expect(summarizeWeekAvailability(undefined, false)).toEqual({
      status: 'unset',
      label: 'Availability not set',
    });
  });
});

describe('weekAvailabilityChipClasses', () => {
  it('returns the muted family for time_off', () => {
    const classes = weekAvailabilityChipClasses('time_off');
    expect(classes?.bg).toContain('muted');
    expect(classes?.text).toContain('muted-foreground');
  });

  it('returns amber for limited', () => {
    const classes = weekAvailabilityChipClasses('limited');
    expect(classes?.bg).toContain('amber');
    expect(classes?.text).toContain('amber');
  });

  it('returns a quiet success treatment for available', () => {
    const classes = weekAvailabilityChipClasses('available');
    expect(classes?.bg).toContain('success');
    expect(classes?.text).toContain('success');
  });

  it('returns null for unset (no chip rendered)', () => {
    expect(weekAvailabilityChipClasses('unset')).toBeNull();
  });
});
