import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildTemplateSnapshot,
  buildShiftsFromTemplate,
  templateWeekBounds,
} from '@/lib/schedulePlanTemplates';
import { formatLocalTimeInTz, wallClockToInstant } from '@/lib/shiftInterval';
import type { Shift, TemplateShiftSnapshot } from '@/types/scheduling';

const CHICAGO = 'America/Chicago';
const HOUR_MS = 60 * 60 * 1000;

function makeShift(overrides: Partial<Shift> & { start_time: string; end_time: string }): Shift {
  return {
    id: 'shift-1',
    restaurant_id: 'rest-1',
    employee_id: 'emp-1',
    break_duration: 30,
    position: 'Server',
    notes: null,
    status: 'scheduled',
    is_published: false,
    locked: false,
    created_at: '2026-03-30T00:00:00Z',
    updated_at: '2026-03-30T00:00:00Z',
    employee: { id: 'emp-1', restaurant_id: 'rest-1', name: 'Alice', position: 'Server', status: 'active', hourly_rate: 15, created_at: '', updated_at: '' } as Shift['employee'],
    ...overrides,
  };
}

function makeSnap(overrides: Partial<TemplateShiftSnapshot>): TemplateShiftSnapshot {
  return {
    day_offset: 0,
    start_time: '09:00:00',
    end_time: '17:00:00',
    break_duration: 30,
    position: 'Server',
    employee_id: 'emp-1',
    employee_name: 'Alice',
    notes: null,
    ...overrides,
  };
}

// The fixtures below are UTC instants with tz 'UTC', so they give the same
// result in every host zone (`npm run test:tz`).
describe('buildTemplateSnapshot', () => {
  const weekStart = new Date(2026, 2, 30); // Monday March 30, 2026

  it('computes correct day_offset from Monday', () => {
    const shift = makeShift({
      start_time: '2026-04-01T09:00:00Z', // Wed Apr 1
      end_time: '2026-04-01T17:00:00Z',
    });

    const result = buildTemplateSnapshot([shift], weekStart, 'UTC');
    expect(result).toHaveLength(1);
    expect(result[0].day_offset).toBe(2);
  });

  it('extracts wall-clock time strings', () => {
    const shift = makeShift({
      start_time: '2026-03-30T09:30:00Z',
      end_time: '2026-03-30T17:00:00Z',
    });

    const result = buildTemplateSnapshot([shift], weekStart, 'UTC');
    expect(result[0].start_time).toBe('09:30:00');
    expect(result[0].end_time).toBe('17:00:00');
  });

  it('includes employee info', () => {
    const shift = makeShift({
      start_time: '2026-03-30T09:00:00Z',
      end_time: '2026-03-30T17:00:00Z',
    });

    const result = buildTemplateSnapshot([shift], weekStart, 'UTC');
    expect(result[0].employee_id).toBe('emp-1');
    expect(result[0].employee_name).toBe('Alice');
    expect(result[0].position).toBe('Server');
    expect(result[0].break_duration).toBe(30);
  });

  it('filters out cancelled shifts', () => {
    const shift = makeShift({
      status: 'cancelled',
      start_time: '2026-03-30T09:00:00Z',
      end_time: '2026-03-30T17:00:00Z',
    });

    const result = buildTemplateSnapshot([shift], weekStart, 'UTC');
    expect(result).toHaveLength(0);
  });

  it('handles Sunday (day_offset = 6)', () => {
    const shift = makeShift({
      start_time: '2026-04-05T10:00:00Z', // Sunday Apr 5
      end_time: '2026-04-05T18:00:00Z',
    });

    const result = buildTemplateSnapshot([shift], weekStart, 'UTC');
    expect(result[0].day_offset).toBe(6);
  });
});

describe('buildShiftsFromTemplate', () => {
  const targetMonday = new Date(2026, 3, 6); // Monday April 6, 2026

  const snapshot: TemplateShiftSnapshot[] = [
    makeSnap({ day_offset: 0, start_time: '09:00:00', end_time: '17:00:00' }),
    makeSnap({
      day_offset: 2,
      start_time: '18:00:00',
      end_time: '23:00:00',
      break_duration: 15,
      position: 'Cook',
      employee_id: 'emp-2',
      employee_name: 'Bob',
      notes: 'Evening shift',
    }),
  ];

  it('maps day_offset to correct target dates', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1', 'UTC');
    expect(result).toHaveLength(2);
    expect(result[0].start_time).toBe('2026-04-06T09:00:00.000Z');
    expect(result[0].end_time).toBe('2026-04-06T17:00:00.000Z');
    expect(result[1].start_time).toBe('2026-04-08T18:00:00.000Z');
    expect(result[1].end_time).toBe('2026-04-08T23:00:00.000Z');
  });

  it('produces BulkShiftInsert-compatible objects', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1', 'UTC');

    expect(result[0]).toMatchObject({
      restaurant_id: 'rest-1',
      employee_id: 'emp-1',
      break_duration: 30,
      position: 'Server',
      notes: null,
      status: 'scheduled',
      is_published: false,
      locked: false,
    });
  });

  it('preserves notes', () => {
    const result = buildShiftsFromTemplate(snapshot, targetMonday, 'rest-1', 'UTC');
    expect(result[1].notes).toBe('Evening shift');
  });
});

// A manager whose browser zone (Asia/Tokyo) is not the restaurant zone
// (America/Chicago). The output must not depend on the browser zone.
describe('with a browser zone that is not the restaurant zone', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Asia/Tokyo');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('runs with the Tokyo host zone', () => {
    // Tokyo has no DST: UTC+9 all year.
    expect(new Date(2026, 3, 6).getTimezoneOffset()).toBe(-540);
  });

  describe('buildTemplateSnapshot', () => {
    it('reads day and wall clock in the restaurant zone', () => {
      const weekStart = new Date(2026, 2, 30);
      // 09:00 CDT Wed Apr 1 = 23:00 Tokyo Wed Apr 1.
      const shift = makeShift({
        start_time: '2026-04-01T14:00:00Z',
        end_time: '2026-04-01T22:00:00Z',
      });

      const [snap] = buildTemplateSnapshot([shift], weekStart, CHICAGO);
      expect(snap.day_offset).toBe(2);
      expect(snap.start_time).toBe('09:00:00');
      expect(snap.end_time).toBe('17:00:00');
    });

    it('keeps a late-Sunday restaurant shift on day 6', () => {
      const weekStart = new Date(2026, 2, 30);
      // Sun Apr 5 23:30 CDT = Mon Apr 6 04:30Z = Mon Apr 6 13:30 Tokyo.
      const shift = makeShift({
        start_time: '2026-04-06T04:30:00Z',
        end_time: '2026-04-06T08:00:00Z',
      });

      const [snap] = buildTemplateSnapshot([shift], weekStart, CHICAGO);
      expect(snap.day_offset).toBe(6);
      expect(snap.start_time).toBe('23:30:00');
      expect(snap.end_time).toBe('03:00:00');
    });

    it('drops shifts from the previous and the next restaurant week', () => {
      const weekStart = new Date(2026, 2, 30);
      const previousSunday = makeShift({
        id: 'prev',
        start_time: '2026-03-29T20:00:00Z', // Sun Mar 29 15:00 CDT
        end_time: '2026-03-29T23:00:00Z',
      });
      const nextMonday = makeShift({
        id: 'next',
        start_time: '2026-04-06T13:00:00Z', // Mon Apr 6 08:00 CDT
        end_time: '2026-04-06T21:00:00Z',
      });
      const inWeek = makeShift({
        id: 'in',
        start_time: '2026-03-30T14:00:00Z',
        end_time: '2026-03-30T22:00:00Z',
      });

      const result = buildTemplateSnapshot([previousSunday, inWeek, nextMonday], weekStart, CHICAGO);
      expect(result).toHaveLength(1);
      expect(result[0].day_offset).toBe(0);
    });

    it('throws INVALID_DATE for a missing or invalid zone', () => {
      const weekStart = new Date(2026, 2, 30);
      const shift = makeShift({
        start_time: '2026-03-30T14:00:00Z',
        end_time: '2026-03-30T22:00:00Z',
      });

      expect(() => buildTemplateSnapshot([shift], weekStart, '')).toThrow('INVALID_DATE');
      expect(() => buildTemplateSnapshot([shift], weekStart, 'Not/AZone')).toThrow('INVALID_DATE');
    });
  });

  describe('buildShiftsFromTemplate', () => {
    it('builds instants in the restaurant zone', () => {
      const [shift] = buildShiftsFromTemplate([makeSnap({})], new Date(2026, 3, 6), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe('2026-04-06T14:00:00.000Z');
      expect(shift.end_time).toBe('2026-04-06T22:00:00.000Z');
    });

    it('uses the correct offset on each side of the fall-back change', () => {
      // Chicago falls back on Sun 2026-11-01.
      const snaps = [0, 1, 2, 3, 4, 5, 6].map((day_offset) => makeSnap({ day_offset }));
      const result = buildShiftsFromTemplate(snaps, new Date(2026, 9, 26), 'rest-1', CHICAGO);

      expect(result.map((s) => s.start_time)).toEqual([
        '2026-10-26T14:00:00.000Z',
        '2026-10-27T14:00:00.000Z',
        '2026-10-28T14:00:00.000Z',
        '2026-10-29T14:00:00.000Z',
        '2026-10-30T14:00:00.000Z',
        '2026-10-31T14:00:00.000Z',
        '2026-11-01T15:00:00.000Z',
      ]);
      for (const s of result) {
        expect(new Date(s.end_time).getTime() - new Date(s.start_time).getTime()).toBe(8 * HOUR_MS);
      }
    });

    it('uses the correct offset on each side of the spring-forward change', () => {
      // Chicago springs forward on Sun 2026-03-08.
      const snaps = [makeSnap({ day_offset: 5 }), makeSnap({ day_offset: 6 })];
      const result = buildShiftsFromTemplate(snaps, new Date(2026, 2, 2), 'rest-1', CHICAGO);
      expect(result[0].start_time).toBe('2026-03-07T15:00:00.000Z');
      expect(result[1].start_time).toBe('2026-03-08T14:00:00.000Z');
    });

    it('resolves a nonexistent spring-forward time like Postgres', () => {
      const snap = makeSnap({ day_offset: 6, start_time: '02:30:00', end_time: '10:00:00' });
      const [shift] = buildShiftsFromTemplate([snap], new Date(2026, 2, 2), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe(wallClockToInstant('2026-03-08', '02:30', CHICAGO).toISOString());
    });

    it('puts an overnight end on the next day across the fall-back change', () => {
      // Sat Oct 31 22:00 CDT to Sun Nov 1 02:00 CST: 5 elapsed hours.
      const snap = makeSnap({ day_offset: 5, start_time: '22:00:00', end_time: '02:00:00' });
      const [shift] = buildShiftsFromTemplate([snap], new Date(2026, 9, 26), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe('2026-11-01T03:00:00.000Z');
      expect(shift.end_time).toBe('2026-11-01T08:00:00.000Z');
    });

    it('throws a clear error when DST makes a shift zero-length or negative', () => {
      const snap = makeSnap({ day_offset: 6, start_time: '02:30:00', end_time: '03:00:00' });
      expect(() => buildShiftsFromTemplate([snap], new Date(2026, 2, 2), 'rest-1', CHICAGO)).toThrow(
        'A template shift has no length on 2026-03-08 after the DST change.',
      );
    });

    it('makes a 24-hour shift when end equals start', () => {
      const snap = makeSnap({ start_time: '09:00:00', end_time: '09:00:00' });
      const [shift] = buildShiftsFromTemplate([snap], new Date(2026, 3, 6), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe('2026-04-06T14:00:00.000Z');
      expect(shift.end_time).toBe('2026-04-07T14:00:00.000Z');
    });

    it('keeps the seconds of the snapshot', () => {
      const snap = makeSnap({ start_time: '09:00:30', end_time: '17:00:45' });
      const [shift] = buildShiftsFromTemplate([snap], new Date(2026, 3, 6), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe('2026-04-06T14:00:30.000Z');
      expect(shift.end_time).toBe('2026-04-06T22:00:45.000Z');
    });

    it('accepts an HH:MM time with no seconds', () => {
      const snap = makeSnap({ start_time: '09:00', end_time: '17:00' });
      const [shift] = buildShiftsFromTemplate([snap], new Date(2026, 3, 6), 'rest-1', CHICAGO);
      expect(shift.start_time).toBe('2026-04-06T14:00:00.000Z');
    });

    it('throws a clear error for a bad stored time', () => {
      for (const bad of ['9am', '25:00:00', '09:60:00', '09:00:60', '']) {
        const snap = makeSnap({ start_time: bad });
        expect(() => buildShiftsFromTemplate([snap], new Date(2026, 3, 6), 'rest-1', CHICAGO)).toThrow(
          'This template has an invalid shift time.',
        );
      }
    });

    it('throws a clear error for a day_offset outside 0..6', () => {
      for (const bad of [-1, 7, 1.5, undefined as unknown as number]) {
        const snap = makeSnap({ day_offset: bad });
        expect(() => buildShiftsFromTemplate([snap], new Date(2026, 3, 6), 'rest-1', CHICAGO)).toThrow(
          'This template has an invalid shift day.',
        );
      }
    });

    it('throws INVALID_DATE for a missing zone', () => {
      expect(() => buildShiftsFromTemplate([makeSnap({})], new Date(2026, 3, 6), 'rest-1', '')).toThrow(
        'INVALID_DATE',
      );
    });

    it('keeps wall clocks in a save-then-apply round trip', () => {
      const weekStart = new Date(2026, 2, 30);
      const shifts = [
        makeShift({ id: 'a', start_time: '2026-03-30T14:00:00Z', end_time: '2026-03-30T22:00:00Z' }),
        makeShift({ id: 'b', start_time: '2026-04-05T01:00:00Z', end_time: '2026-04-05T06:00:00Z' }),
      ];

      const snapshot = buildTemplateSnapshot(shifts, weekStart, CHICAGO);
      const applied = buildShiftsFromTemplate(snapshot, new Date(2026, 3, 6), 'rest-1', CHICAGO);

      expect(applied.map((s) => formatLocalTimeInTz(s.start_time, CHICAGO))).toEqual(
        snapshot.map((s) => s.start_time),
      );
      expect(applied.map((s) => formatLocalTimeInTz(s.end_time, CHICAGO))).toEqual(
        snapshot.map((s) => s.end_time),
      );
    });
  });

  describe('templateWeekBounds', () => {
    it('spans the restaurant week, not the browser week', () => {
      expect(templateWeekBounds(new Date(2026, 3, 6), CHICAGO)).toEqual({
        start: '2026-04-06T05:00:00.000Z',
        end: '2026-04-13T04:59:59.999Z',
      });
    });

    it('spans 169 hours in the fall-back week', () => {
      const { start, end } = templateWeekBounds(new Date(2026, 9, 26), CHICAGO);
      expect(new Date(end).getTime() + 1 - new Date(start).getTime()).toBe(169 * HOUR_MS);
    });

    it('throws INVALID_DATE for a missing or invalid zone', () => {
      expect(() => templateWeekBounds(new Date(2026, 3, 6), '')).toThrow('INVALID_DATE');
      expect(() => templateWeekBounds(new Date(2026, 3, 6), 'Not/AZone')).toThrow('INVALID_DATE');
    });
  });
});

// The restaurant wall clock falls in a DST gap of the browser zone. Berlin
// springs forward on 2026-03-29 at 02:00; the US changed on 2026-03-08.
describe('with a restaurant wall clock in a browser DST gap', () => {
  beforeEach(() => {
    vi.stubEnv('TZ', 'Europe/Berlin');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('saves the restaurant wall clock, not the host-shifted one', () => {
    // Sun 2026-03-29 02:30 CDT = 07:30Z. 02:30 does not exist in Berlin that day.
    const shift = makeShift({
      start_time: '2026-03-29T07:30:00Z',
      end_time: '2026-03-29T12:00:00Z',
    });

    const [snap] = buildTemplateSnapshot([shift], new Date(2026, 2, 23), CHICAGO);
    expect(snap.day_offset).toBe(6);
    expect(snap.start_time).toBe('02:30:00');
    expect(snap.end_time).toBe('07:00:00');
  });
});
