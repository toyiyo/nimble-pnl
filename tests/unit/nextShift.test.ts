import { describe, it, expect } from 'vitest';
import { selectUpcomingShifts, countShiftsInWeek } from '@/lib/nextShift';
import type { Shift } from '@/types/scheduling';

const NY = 'America/New_York';

function shift(id: string, start: string, end: string, status = 'scheduled'): Shift {
  return { id, start_time: start, end_time: end, status } as Shift;
}

const NOW = new Date('2026-08-19T16:00:00Z');

describe('selectUpcomingShifts', () => {
  it('returns an empty list when no shift is upcoming', () => {
    const past = shift('a', '2026-08-18T12:00:00Z', '2026-08-18T20:00:00Z');
    expect(selectUpcomingShifts([past], NOW)).toEqual([]);
  });

  it('returns the soonest shift first', () => {
    const later = shift('b', '2026-08-22T12:00:00Z', '2026-08-22T20:00:00Z');
    const sooner = shift('c', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z');
    const result = selectUpcomingShifts([later, sooner], NOW);
    expect(result.map((s) => s.id)).toEqual(['c', 'b']);
  });

  it('keeps a shift that is in progress', () => {
    const running = shift('d', '2026-08-19T12:00:00Z', '2026-08-19T20:00:00Z');
    expect(selectUpcomingShifts([running], NOW).map((s) => s.id)).toEqual(['d']);
  });

  it('skips a cancelled shift', () => {
    const cancelled = shift('e', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z', 'cancelled');
    expect(selectUpcomingShifts([cancelled], NOW)).toEqual([]);
  });

  it('keeps a draft shift', () => {
    const draft = { ...shift('f', '2026-08-20T12:00:00Z', '2026-08-20T20:00:00Z'), is_published: false } as Shift;
    expect(selectUpcomingShifts([draft], NOW).map((s) => s.id)).toEqual(['f']);
  });

  it('respects the limit', () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map((n) =>
      shift(`s${n}`, `2026-08-2${n}T12:00:00Z`, `2026-08-2${n}T20:00:00Z`)
    );
    expect(selectUpcomingShifts(many, NOW, 5)).toHaveLength(5);
  });
});

describe('countShiftsInWeek', () => {
  const nextWeekStart = new Date(2026, 7, 24);

  it('counts a shift inside the week', () => {
    const inside = shift('a', '2026-08-26T16:00:00Z', '2026-08-27T00:00:00Z');
    expect(countShiftsInWeek([inside], nextWeekStart, NY)).toBe(1);
  });

  it('skips a shift before the week', () => {
    const before = shift('b', '2026-08-21T16:00:00Z', '2026-08-22T00:00:00Z');
    expect(countShiftsInWeek([before], nextWeekStart, NY)).toBe(0);
  });

  it('skips a shift after the week', () => {
    const after = shift('c', '2026-09-01T16:00:00Z', '2026-09-02T00:00:00Z');
    expect(countShiftsInWeek([after], nextWeekStart, NY)).toBe(0);
  });

  it('counts by the restaurant day, not the UTC day', () => {
    // 01:00 UTC on Monday is 21:00 Sunday in New York, so the shift belongs
    // to the week that ends, not to the week that starts.
    const sundayNight = shift('d', '2026-08-24T01:00:00Z', '2026-08-24T05:00:00Z');
    expect(countShiftsInWeek([sundayNight], nextWeekStart, NY)).toBe(0);
    expect(countShiftsInWeek([sundayNight], nextWeekStart, 'UTC')).toBe(1);
  });

  it('skips a cancelled shift', () => {
    const cancelled = shift('e', '2026-08-26T16:00:00Z', '2026-08-27T00:00:00Z', 'cancelled');
    expect(countShiftsInWeek([cancelled], nextWeekStart, NY)).toBe(0);
  });
});
