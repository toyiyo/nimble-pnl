/**
 * Naive wall-clock strings at and away from DST edges, with the UTC instant
 * Postgres resolves them to. Consumed twice -- by Vitest against
 * `parseWallClock` and by pgTAP against
 * `(wallClock::timestamp AT TIME ZONE tz)` -- so the client parser and the
 * authoritative SQL cannot drift apart unnoticed.
 *
 * Postgres resolves BOTH a repeated (ambiguous, fall-back) and a nonexistent
 * (spring-forward) wall clock using the zone's STANDARD (non-DST) UTC
 * offset. Verified empirically against local Postgres in both
 * America/Chicago and Australia/Sydney (opposite-hemisphere DST direction)
 * -- see `docker exec ... psql` commands in `.superpowers/sdd/task-4-report.md`.
 *
 * Keep this in sync with `supabase/tests/wall_clock_parity.sql`;
 * `tests/unit/wallClockParity.test.ts` fails if they diverge.
 */
export const WALL_CLOCK_FIXTURES = [
  // Fall-back: 2026-11-01T01:30 Chicago is the repeated hour (both CDT and
  // CST agree it's a valid local time). Postgres picks the standard (CST,
  // second/later) occurrence.
  { wallClock: '2026-11-01T01:30', tz: 'America/Chicago', expectedInstant: '2026-11-01T07:30:00.000Z' },
  // Spring-forward: 2026-03-08T02:30 Chicago does not exist (clocks jump from
  // 01:59:59 CST straight to 03:00:00 CDT). Postgres still resolves it with
  // the standard (CST) offset.
  { wallClock: '2026-03-08T02:30', tz: 'America/Chicago', expectedInstant: '2026-03-08T08:30:00.000Z' },
  // Fall-back in the opposite hemisphere (Sydney DST runs Oct-Apr): the AFTER
  // offset (AEST) happens to be the valid, standard one here.
  { wallClock: '2026-04-05T02:30', tz: 'Australia/Sydney', expectedInstant: '2026-04-04T16:30:00.000Z' },
  // Spring-forward in Sydney: the BEFORE offset (AEST) happens to be the
  // valid, standard one here -- opposite of the fall-back case above, which
  // is why "standard offset" (not "before"/"after") is the rule that holds
  // for both.
  { wallClock: '2026-10-04T02:30', tz: 'Australia/Sydney', expectedInstant: '2026-10-03T16:30:00.000Z' },
  // Unambiguous controls, away from any transition.
  { wallClock: '2026-07-22T20:56', tz: 'America/Chicago', expectedInstant: '2026-07-23T01:56:00.000Z' },
  { wallClock: '2026-06-15T10:00', tz: 'Australia/Sydney', expectedInstant: '2026-06-15T00:00:00.000Z' },
  // Mutation-killers: unambiguous wall clocks that nonetheless fall inside the
  // +/-24h bracket window of a DST transition and resolve to the DST (larger,
  // more-east) offset. A mutation that skips the round-trip validity filter
  // and always takes Math.min(offsetBefore, offsetAfter) would silently pick
  // the standard offset here instead and shift the result by an hour -- these
  // are the rows that catch that regression. Both hemispheres.
  { wallClock: '2026-03-08T03:30', tz: 'America/Chicago', expectedInstant: '2026-03-08T08:30:00.000Z' },
  { wallClock: '2026-11-01T00:30', tz: 'America/Chicago', expectedInstant: '2026-11-01T05:30:00.000Z' },
  { wallClock: '2026-10-04T03:30', tz: 'Australia/Sydney', expectedInstant: '2026-10-03T16:30:00.000Z' },
  { wallClock: '2026-04-05T01:30', tz: 'Australia/Sydney', expectedInstant: '2026-04-04T14:30:00.000Z' },
  // Europe/Dublin: a negative-DST zone -- tzdb designates Ireland's summer
  // (+1) as *standard* and represents winter as a negative DST offset, so
  // "smaller numeric offset" and "the tzdb isdst flag" pick opposite answers
  // here. Postgres was confirmed (local Postgres, see task-4-report.md) to
  // follow the smaller numeric offset, and these rows pin that
  // parseWallClock matches Postgres rather than the tzdb designation.
  { wallClock: '2026-10-25T01:30', tz: 'Europe/Dublin', expectedInstant: '2026-10-25T01:30:00.000Z' },
  { wallClock: '2026-03-29T01:30', tz: 'Europe/Dublin', expectedInstant: '2026-03-29T01:30:00.000Z' },
  // Australia/Lord_Howe: a 30-minute DST shift, pinning that nothing assumes
  // a 1-hour transition delta.
  { wallClock: '2026-04-05T01:45', tz: 'Australia/Lord_Howe', expectedInstant: '2026-04-04T15:15:00.000Z' },
  { wallClock: '2026-10-04T02:15', tz: 'Australia/Lord_Howe', expectedInstant: '2026-10-03T15:45:00.000Z' },
] as const;
