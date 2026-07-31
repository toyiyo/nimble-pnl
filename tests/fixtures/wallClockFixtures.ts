/**
 * The single source of truth for wall-clock -> instant conversion, shared by
 * the TypeScript and Postgres sides of the parity contract.
 *
 * The premise of this whole area is that `restaurantClock.ts::parseWallClock`
 * and Postgres' `(...)::timestamp AT TIME ZONE tz` resolve every wall clock
 * to the SAME instant, including the two DST edges where a wall clock is
 * ambiguous (fall-back, the repeated hour) or nonexistent (spring-forward,
 * the skipped hour). The client previews a shift with one; the server stores
 * it with the other. If they ever disagree, a shift silently moves.
 *
 * Two suites assert that premise against these rows:
 *   - `tests/unit/wallClockParity.test.ts` runs them through `parseWallClock`,
 *     and separately checks that `supabase/tests/wall_clock_parity.sql`
 *     contains exactly these rows, in this order.
 *   - `supabase/tests/wall_clock_parity.sql` runs them through Postgres.
 *
 * That second check is the load-bearing one. Without it the two lists drift:
 * a row added here is never proven against a real Postgres, and a row added
 * there is never proven against the TypeScript. Both halves would stay green
 * while the contract they exist to protect quietly stopped holding.
 *
 * `expectedInstant` values are what production Postgres actually returns —
 * they are observations, not derivations. Do not "correct" one to match a
 * mental model of the rule; if a value here looks wrong, the rule is wrong.
 */
export interface WallClockFixture {
  /** Restaurant-local wall clock, `YYYY-MM-DDTHH:MM` (never an instant). */
  wallClock: string;
  /** IANA zone. */
  tz: string;
  /** The UTC instant Postgres resolves `wallClock` to in `tz`. */
  expectedInstant: string;
  /** Why this row is in the table — what it would catch if it broke. */
  note: string;
}

export const WALL_CLOCK_FIXTURES: readonly WallClockFixture[] = [
  {
    wallClock: '2026-11-01T01:30',
    tz: 'America/Chicago',
    expectedInstant: '2026-11-01T07:30:00.000Z',
    note: 'fall-back: 01:30 happens twice; Postgres picks the SECOND (CST, the smaller offset)',
  },
  {
    wallClock: '2026-03-08T02:30',
    tz: 'America/Chicago',
    expectedInstant: '2026-03-08T08:30:00.000Z',
    note: 'spring-forward: 02:30 never happens; Postgres reads it with the smaller (CST) offset',
  },
  {
    wallClock: '2026-04-05T02:30',
    tz: 'Australia/Sydney',
    expectedInstant: '2026-04-04T16:30:00.000Z',
    note: 'southern-hemisphere fall-back — DST ends in April, not November',
  },
  {
    wallClock: '2026-10-04T02:30',
    tz: 'Australia/Sydney',
    expectedInstant: '2026-10-03T16:30:00.000Z',
    note: 'southern-hemisphere spring-forward — DST starts in October',
  },
  {
    wallClock: '2026-07-22T20:56',
    tz: 'America/Chicago',
    expectedInstant: '2026-07-23T01:56:00.000Z',
    note: 'ordinary unambiguous clock — the common path must not regress while chasing the edges',
  },
  {
    wallClock: '2026-06-15T10:00',
    tz: 'Australia/Sydney',
    expectedInstant: '2026-06-15T00:00:00.000Z',
    note: 'ordinary unambiguous clock in a zone AHEAD of UTC',
  },
  {
    wallClock: '2026-03-08T03:30',
    tz: 'America/Chicago',
    expectedInstant: '2026-03-08T08:30:00.000Z',
    note: 'the first real clock after the skipped hour — same instant as 02:30, which is the point',
  },
  {
    wallClock: '2026-11-01T00:30',
    tz: 'America/Chicago',
    expectedInstant: '2026-11-01T05:30:00.000Z',
    note: 'the hour before fall-back — still CDT, so the transition is not applied early',
  },
  {
    wallClock: '2026-10-04T03:30',
    tz: 'Australia/Sydney',
    expectedInstant: '2026-10-03T16:30:00.000Z',
    note: 'first real clock after Sydney\'s skipped hour',
  },
  {
    wallClock: '2026-04-05T01:30',
    tz: 'Australia/Sydney',
    expectedInstant: '2026-04-04T14:30:00.000Z',
    note: 'the hour before Sydney\'s fall-back — still AEDT',
  },
  {
    // The decisive rows. tzdb models Dublin with NEGATIVE DST: its standard
    // zone is IST (+1:00) and "winter" is the offset, so the STANDARD offset
    // is the LARGER one here. Any implementation that resolves ambiguity by
    // "pick the standard offset" agrees with `Math.min(before, after)` in
    // Chicago and Sydney and disagrees here. Without Dublin, the two rules
    // are indistinguishable and the wrong one passes every other row.
    wallClock: '2026-10-25T01:30',
    tz: 'Europe/Dublin',
    expectedInstant: '2026-10-25T01:30:00.000Z',
    note: 'Dublin fall-back: resolves with the SMALLER offset, which is NOT the standard one',
  },
  {
    wallClock: '2026-03-29T01:30',
    tz: 'Europe/Dublin',
    expectedInstant: '2026-03-29T01:30:00.000Z',
    note: 'Dublin spring-forward: same discriminator in the other direction',
  },
  {
    // Lord Howe shifts by 30 minutes, not 60 — the only such zone in tzdb.
    // Any arithmetic that assumes whole-hour transitions passes everything
    // above and fails here.
    wallClock: '2026-04-05T01:45',
    tz: 'Australia/Lord_Howe',
    expectedInstant: '2026-04-04T15:15:00.000Z',
    note: 'half-hour DST shift, fall-back',
  },
  {
    wallClock: '2026-10-04T02:15',
    tz: 'Australia/Lord_Howe',
    expectedInstant: '2026-10-03T15:45:00.000Z',
    note: 'half-hour DST shift, spring-forward',
  },
];
