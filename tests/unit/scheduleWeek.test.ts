import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getRestaurantWeekStart, getRelativeWeekLabel } from '@/lib/scheduleWeek';

const NY = 'America/New_York';

// Every assertion below compares a restaurant-tz result against a host-local
// `new Date(y, m, d)` fixture. If the test host's own timezone happened to be
// `America/New_York`, a regression that read the host clock instead of the
// restaurant clock would produce the same civil date and the assertion would
// pass while proving nothing -- the same silent-pass risk documented at
// `tests/unit/useShiftsRecurringCreateTz.test.ts:80`. Pin the host to Phoenix
// (fixed UTC-7, no DST) and assert the offset actually differs from NY's
// (UTC-4 in August) so a coincidental match cannot happen here.
const ORIGINAL_TZ = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'America/Phoenix';
  expect(new Date('2026-08-19T12:00:00Z').getTimezoneOffset()).toBe(420);
});

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe('getRestaurantWeekStart', () => {
  it('returns the Monday of the restaurant week', () => {
    const now = new Date('2026-08-19T16:00:00Z');
    expect(getRestaurantWeekStart(now, NY)).toEqual(new Date(2026, 7, 17));
  });

  it('uses the restaurant day, not the UTC day', () => {
    // 02:00 UTC on Monday is 22:00 Sunday in New York, so the restaurant
    // week has not turned over yet.
    const now = new Date('2026-08-17T02:00:00Z');
    expect(getRestaurantWeekStart(now, NY)).toEqual(new Date(2026, 7, 10));
    expect(getRestaurantWeekStart(now, 'UTC')).toEqual(new Date(2026, 7, 17));
  });
});

describe('getRelativeWeekLabel', () => {
  const now = new Date('2026-08-19T16:00:00Z');

  it('labels the current week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 17), now, NY)).toBe('This week');
  });

  it('labels the next week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 24), now, NY)).toBe('Next week');
  });

  it('labels the previous week', () => {
    expect(getRelativeWeekLabel(new Date(2026, 7, 10), now, NY)).toBe('Last week');
  });

  it('labels a week further ahead', () => {
    expect(getRelativeWeekLabel(new Date(2026, 8, 7), now, NY)).toBe('In 3 weeks');
  });

  it('labels a week further back', () => {
    expect(getRelativeWeekLabel(new Date(2026, 6, 27), now, NY)).toBe('3 weeks ago');
  });

  it('labels the current week from the restaurant day, not the UTC day', () => {
    const sundayNight = new Date('2026-08-17T02:00:00Z');
    expect(getRelativeWeekLabel(new Date(2026, 7, 10), sundayNight, NY)).toBe('This week');
  });
});
