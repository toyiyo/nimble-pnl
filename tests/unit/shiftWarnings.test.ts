import { describe, it, expect } from 'vitest';
import {
  MIN_REST_HOURS,
  findShiftWarnings,
  intervalsOverlap,
  restHoursBetween,
  type WarnShift,
} from '../../supabase/functions/_shared/shiftWarnings';

const mk = (
  id: string,
  start: string,
  end: string,
  over: Partial<WarnShift> = {},
): WarnShift => ({
  id,
  employee_id: 'e1',
  start_time: start,
  end_time: end,
  status: 'scheduled',
  ...over,
});

describe('shiftWarnings helpers', () => {
  it('exports an 8 hour minimum rest', () => {
    expect(MIN_REST_HOURS).toBe(8);
  });
  it('intervalsOverlap treats touching intervals as not overlapping', () => {
    expect(intervalsOverlap(0, 10, 10, 20)).toBe(false);
    expect(intervalsOverlap(0, 11, 10, 20)).toBe(true);
  });
  it('restHoursBetween returns 0 when the gap is not positive', () => {
    expect(restHoursBetween(100, 50)).toBe(0);
    expect(restHoursBetween(0, 3600000)).toBe(1);
  });
});

describe('findShiftWarnings', () => {
  it('flags overlap on both shifts', () => {
    const w = findShiftWarnings([
      mk('a', '2026-01-05T09:00:00Z', '2026-01-05T17:00:00Z'),
      mk('b', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
    ]);
    expect(w.filter((x) => x.type === 'overlap')).toHaveLength(2);
    expect(w).toContainEqual(
      expect.objectContaining({ shift_id: 'a', type: 'overlap', rule: 'editor', other_shift_id: 'b' }),
    );
    expect(w).toContainEqual(
      expect.objectContaining({ shift_id: 'b', type: 'overlap', rule: 'editor', other_shift_id: 'a' }),
    );
  });
  it('flags clopen under 8 hours', () => {
    const w = findShiftWarnings([
      mk('a', '2026-01-05T15:00:00Z', '2026-01-05T23:00:00Z'),
      mk('b', '2026-01-06T06:54:00Z', '2026-01-06T14:00:00Z'),
    ]);
    expect(w).toEqual([
      { shift_id: 'b', type: 'clopen', rule: 'editor', other_shift_id: 'a', rest_hours: 7.9 },
    ]);
  });
  it('does not flag exactly 8 hours', () => {
    expect(
      findShiftWarnings([
        mk('a', '2026-01-05T15:00:00Z', '2026-01-05T23:00:00Z'),
        mk('b', '2026-01-06T07:00:00Z', '2026-01-06T15:00:00Z'),
      ]),
    ).toEqual([]);
  });
  it('ignores cancelled shifts in either role', () => {
    expect(
      findShiftWarnings([
        mk('a', '2026-01-05T09:00:00Z', '2026-01-05T17:00:00Z', { status: 'cancelled' }),
        mk('b', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z'),
      ]),
    ).toEqual([]);
    expect(
      findShiftWarnings([
        mk('a', '2026-01-05T09:00:00Z', '2026-01-05T17:00:00Z'),
        mk('b', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z', { status: 'cancelled' }),
      ]),
    ).toEqual([]);
  });
  it('ignores overlap across different employees', () => {
    expect(
      findShiftWarnings([
        mk('a', '2026-01-05T09:00:00Z', '2026-01-05T17:00:00Z'),
        mk('b', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z', { employee_id: 'e2' }),
      ]),
    ).toEqual([]);
  });
  it('flags a midnight close and a 06:00 open as 6.0 hours', () => {
    const w = findShiftWarnings([
      mk('a', '2026-01-05T16:00:00Z', '2026-01-06T00:00:00Z'),
      mk('b', '2026-01-06T06:00:00Z', '2026-01-06T12:00:00Z'),
    ]);
    expect(w).toEqual([
      { shift_id: 'b', type: 'clopen', rule: 'editor', other_shift_id: 'a', rest_hours: 6 },
    ]);
  });
  it('skips shifts with a null employee_id', () => {
    expect(
      findShiftWarnings([
        mk('a', '2026-01-05T09:00:00Z', '2026-01-05T17:00:00Z', { employee_id: null }),
        mk('b', '2026-01-05T16:00:00Z', '2026-01-05T22:00:00Z', { employee_id: null }),
      ]),
    ).toEqual([]);
  });
});
