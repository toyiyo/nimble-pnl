import { HOST_CALENDAR_DAY_FRAME } from '@/lib/businessDay';

/**
 * Shared fixture corpus for the business-day cutoff.
 *
 * SQL_PARITY_FIXTURES is the single table consumed by BOTH
 * tests/unit/businessDay.test.ts and supabase/tests/business_day_cutoff.test.sql.
 * Both must agree with `expected` -- the STATED expectation -- not merely with
 * each other. Two implementations agreeing on a wrong answer is the failure
 * mode a mutual-comparison test cannot see.
 */
export interface SqlParityFixture {
  name: string;
  /** ISO 8601 instant with an explicit offset. */
  instant: string;
  tz: string;
  cutoffHour: number;
  /** YYYY-MM-DD. */
  expected: string;
}

export const SQL_PARITY_FIXTURES: SqlParityFixture[] = [
  {
    name: '18:00 CDT clock-in, cutoff 2 -> own day',
    instant: '2026-07-28T23:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: '01:00 CDT clock-in, cutoff 2 -> previous day (the feature)',
    instant: '2026-07-29T06:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: '03:00 CDT clock-in, cutoff 2 -> own day',
    instant: '2026-07-29T08:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-07-29',
  },
  {
    name: 'cutoff 0 == restaurant-local calendar day',
    instant: '2026-07-29T06:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 0,
    expected: '2026-07-29',
  },
  {
    name: 'fall-back repeated hour (2nd 01:30 CST) -> previous day',
    instant: '2026-11-01T07:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-10-31',
  },
  {
    name: 'fall-back after transition, 02:30 CST -> own day',
    instant: '2026-11-01T08:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-11-01',
  },
  {
    name: 'spring-forward 03:30 CDT -> own day',
    instant: '2026-03-08T09:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-03-08',
  },
  {
    name: 'spring-forward 01:30 CST -> previous day',
    instant: '2026-03-08T07:30:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 2,
    expected: '2026-03-07',
  },
  {
    // NZST (+12), not NZDT: July is winter in Auckland, so DST is off.
    name: 'east of UTC: 01:30 NZST, cutoff 2 -> previous day',
    instant: '2026-07-28T13:30:00+00:00',
    tz: 'Pacific/Auckland',
    cutoffHour: 2,
    expected: '2026-07-28',
  },
  {
    name: 'upper bound cutoff 11, 10:00 local -> previous day',
    instant: '2026-07-29T15:00:00+00:00',
    tz: 'America/Chicago',
    cutoffHour: 11,
    expected: '2026-07-28',
  },
];

/**
 * The migration frame for pre-existing call sites whose fixtures carry an
 * EXPLICIT offset (`...Z` or `+00:00`).
 *
 * For those, UTC is frame-stable: fixture and frame agree no matter which zone
 * the test runs in. NEW tests should name a real restaurant zone instead.
 *
 * Do NOT use this for fixtures with naive timestamps -- see HOST_LOCAL_FRAME.
 */
export const LEGACY_UTC_FRAME = { tz: 'UTC', cutoffHour: 0 } as const;

/**
 * The migration frame for pre-existing call sites whose fixtures use NAIVE
 * timestamps (`'2025-12-09T22:00:00'`, no offset).
 *
 * Those are parsed in the host's zone, so the frame that reproduces the old
 * formatLocalDate() bucketing byte for byte is the host's zone -- not UTC.
 * Under TZ=UTC the two frames are indistinguishable, which is precisely why
 * picking the wrong one is invisible in a default CI runner and shows up only
 * east of Greenwich. Resolving the host zone here keeps fixture and frame
 * moving together in every zone the tz matrix exercises.
 *
 * Aliases the production default so the two can never drift: this IS the frame
 * calculateEmployeePay falls back to when no config is threaded.
 */
export const HOST_LOCAL_FRAME = HOST_CALENDAR_DAY_FRAME;
