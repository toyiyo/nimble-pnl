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
  start_time_local: '09:00:00',
  end_time_local: '17:00:00',
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

const TZ = 'America/Chicago';

describe('computeEffectiveAvailability', () => {
  // Week of Apr 6 (Mon) to Apr 12 (Sun), 2026
  const weekStart = new Date(2026, 3, 6); // Mon Apr 6
  const employeeIds = ['emp-1'];

  it('returns not-set when employee has no availability or exceptions', () => {
    const result = computeEffectiveAvailability([], [], weekStart, employeeIds, TZ);
    const monday = result.get('emp-1')?.get(1); // day_of_week 1 = Monday
    expect(monday).toEqual({ type: 'not-set', slots: [] });
  });

  it('returns recurring availability when no exception exists', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 1 })];
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds, TZ);
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
    const result = computeEffectiveAvailability(avail, exceptions, weekStart, employeeIds, TZ);
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
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds, TZ);
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
    const result = computeEffectiveAvailability(avail, exceptions, weekStart, employeeIds, TZ);
    const monday = result.get('emp-1')?.get(1);
    expect(monday?.type).toBe('recurring');
  });

  it('recurring unavailable (is_available=false) returns unavailable slot', () => {
    const avail = [makeAvailability({ employee_id: 'emp-1', day_of_week: 0, is_available: false })];
    const result = computeEffectiveAvailability(avail, [], weekStart, employeeIds, TZ);
    const sunday = result.get('emp-1')?.get(0);
    expect(sunday?.type).toBe('recurring');
    expect(sunday?.slots[0].isAvailable).toBe(false);
  });

  it('multiple employees are handled independently', () => {
    const avail = [
      makeAvailability({ employee_id: 'emp-1', day_of_week: 1, start_time_local: '09:00:00', end_time_local: '17:00:00' }),
      makeAvailability({ employee_id: 'emp-2', day_of_week: 1, start_time_local: '06:00:00', end_time_local: '14:00:00' }),
    ];
    const result = computeEffectiveAvailability(avail, [], weekStart, ['emp-1', 'emp-2'], TZ);
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
  it('formats an available window from local slot times', () => {
    expect(availabilityLabel(avail(true, '10:00:00', '22:00:00'))).toBe('Available 10:00 AM – 10:00 PM');
  });
  it('gives Available when the window is null', () => {
    expect(availabilityLabel(avail(true, null, null))).toBe('Available');
  });
  it('labels unavailable and not-set', () => {
    expect(availabilityLabel(avail(false, null, null, 'recurring'))).toBe(
      'Unavailable',
    );
    expect(availabilityLabel(avail(false, null, null, 'not-set'))).toBe('No availability set');
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
    const label = availabilityLabel(splitDay);
    expect(label).toBe('Available 1:00 PM – 4:00 PM + 8:00 PM – 11:00 PM');
  });
});

describe('shiftOutsideAvailability (TZ-portable)', () => {
  // Employee available 2:00 PM-10:30 PM local (slot times are already local).
  const nyAvail = avail(true, '14:00:00', '22:30:00');
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
    // Friday 6:00 PM - 2:00 AM local recurring window.
    const fridayOvernight = avail(true, '18:00:00', '02:00:00');

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

  // Slot times are local, so a DST-transition day needs no offset anchor.
  // Saturday local 6:00 PM - 3:00 AM spills into Sunday Mar 12, 2028 (spring-forward).
  it('reads the previous day overnight window as local across a spring-forward day', () => {
    const notSetToday = avail(false, null, null, 'not-set');
    const saturdayOvernight = avail(true, '18:00:00', '03:00:00');
    expect(
      shiftOutsideAvailability(
        notSetToday,
        saturdayOvernight,
        new Date('2028-03-12T07:15:00Z'), // 3:15 AM EDT Sunday, past the 3:00 AM end
        new Date('2028-03-12T07:30:00Z'),
        'America/New_York',
        new Date(2028, 2, 12),
      ),
    ).toBe(true);
  });

  // Codex finding: a shift crossing into the next local day must also be
  // checked against that NEXT day's own hard-off data — today's window
  // extended past midnight can't paper over Saturday's own unavailable
  // exception, mirroring the RPC's per-local-date walk (block 3c's forward
  // counterpart).
  describe('next-day override on a shift crossing midnight forward', () => {
    // Friday recurring window 6:00 PM - 00:00. A 00:00 end is a day end, not a spill.
    const fridayOvernight = avail(true, '18:00:00', '00:00:00');
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

describe('local-time slots and the RPC rules', () => {
  const wk = new Date(2026, 6, 13); // Mon 2026-07-13
  const chi = 'America/Chicago';
  const win = (s: string, e: string): EffectiveAvailability => avail(true, s, e);
  const off = avail(false, null, null);
  const notSet = avail(false, null, null, 'not-set');
  const noop = new Date(2026, 6, 13);
  const run = (
    today: EffectiveAvailability,
    prev: EffectiveAvailability | undefined,
    next: EffectiveAvailability | undefined,
    startUtc: string,
    endUtc: string,
  ) => shiftOutsideAvailability(today, prev, new Date(startUtc), new Date(endUtc), 'UTC', noop, next);

  it('recurring slot uses the local columns', () => {
    for (const week of [wk, new Date(2026, 11, 14)]) {
      const rows = [
        makeAvailability({
          employee_id: 'e', day_of_week: 1,
          start_time: '15:00:00', end_time: '03:00:00',
          start_time_local: '10:00:00', end_time_local: '22:00:00',
        }),
      ];
      const slot = computeEffectiveAvailability(rows, [], week, ['e'], chi).get('e')!.get(1)!.slots[0];
      expect(slot.startTime).toBe('10:00:00');
      expect(slot.endTime).toBe('22:00:00');
    }
  });

  it('available recurring row with null local columns has no window', () => {
    const rows = [
      makeAvailability({
        employee_id: 'e', day_of_week: 1,
        start_time_local: null, end_time_local: null,
      }),
    ];
    const eff = computeEffectiveAvailability(rows, [], wk, ['e'], chi).get('e')!.get(1)!;
    expect(eff.slots[0].isAvailable).toBe(true);
    expect(eff.slots[0].startTime).toBeNull();
    expect(eff.slots[0].endTime).toBeNull();
    expect(availabilityLabel(eff)).toBe('Available');
  });

  it('exception slot converts with the exception date as anchor', () => {
    const cases: Array<[string, string, Date]> = [
      ['2026-03-08', '15:00:00', new Date(2026, 2, 2)], // CDT after spring-forward
      ['2026-03-07', '16:00:00', new Date(2026, 2, 2)], // CST the day before
    ];
    for (const [date, t, week] of cases) {
      const exc = [makeException({ employee_id: 'e', date, is_available: true, start_time: t, end_time: '23:00:00' })];
      const dow = new Date(date + 'T12:00:00').getDay();
      const slot = computeEffectiveAvailability([], exc, week, ['e'], chi).get('e')!.get(dow)!.slots[0];
      expect(slot.startTime).toBe('10:00');
    }
  });

  it('exception reader matches the RPC formula', () => {
    // F1: the RPC converts the exception UTC clock with the exception date as anchor.
    // This pins that agreement. See the F1 follow-up in the PR 2 plan.
    const exc = [makeException({ employee_id: 'e', date: '2026-03-08', is_available: true, start_time: '03:00:00', end_time: '12:00:00' })];
    const slot = computeEffectiveAvailability([], exc, new Date(2026, 2, 2), ['e'], chi).get('e')!.get(0)!.slots[0];
    expect(slot.startTime).toBe('21:00');
  });

  it('midnight end is not an overnight spill', () => {
    const mon = win('18:00:00', '00:00:00');
    const tue = win('08:00:00', '12:00:00');
    expect(run(tue, mon, undefined, '2026-07-14T00:30:00Z', '2026-07-14T02:00:00Z')).toBe(true);
    expect(run(mon, undefined, tue, '2026-07-13T18:00:00Z', '2026-07-13T23:59:00Z')).toBe(false);
  });

  it('shift that ends at 00:00 ignores the next day', () => {
    expect(run(win('12:00:00', '00:00:00'), undefined, off, '2026-07-13T12:00:00Z', '2026-07-14T00:00:00Z')).toBe(false);
    expect(
      run(win('18:00:00', '00:00:00'), undefined, win('08:00:00', '12:00:00'), '2026-07-13T18:00:00Z', '2026-07-14T00:00:00Z'),
    ).toBe(false);
  });

  it('each local date part is checked on its own', () => {
    const mon = win('18:00:00', '00:00:00');
    const s = '2026-07-13T22:00:00Z';
    const e = '2026-07-14T02:00:00Z';
    expect(run(mon, undefined, win('00:00:00', '06:00:00'), s, e)).toBe(false);
    expect(run(mon, undefined, notSet, s, e)).toBe(false);
    expect(run(mon, undefined, win('03:00:00', '06:00:00'), s, e)).toBe(true);
  });

  it('today off but yesterday spills', () => {
    const sun = win('20:00:00', '04:00:00');
    expect(run(off, sun, undefined, '2026-07-13T01:00:00Z', '2026-07-13T03:00:00Z')).toBe(false);
    expect(run(off, sun, undefined, '2026-07-13T03:00:00Z', '2026-07-13T05:00:00Z')).toBe(true);
  });

  it('10:00-22:00 window gives no conflict in July and December', () => {
    const w = win('10:00:00', '22:00:00');
    const chiShift = (s: string, e: string) =>
      shiftOutsideAvailability(w, undefined, new Date(s), new Date(e), chi, new Date(2026, 6, 15));
    expect(chiShift('2026-07-15T15:00:00Z', '2026-07-16T03:00:00Z')).toBe(false); // CDT
    expect(chiShift('2026-12-16T16:00:00Z', '2026-12-17T04:00:00Z')).toBe(false); // CST
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
