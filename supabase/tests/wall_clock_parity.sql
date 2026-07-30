-- Asserts Postgres agrees with src/lib/restaurantClock.ts::parseWallClock,
-- including at the DST fall-back (repeated hour) and spring-forward
-- (nonexistent hour) edges.
-- Rows MUST match tests/fixtures/wallClockFixtures.ts exactly;
-- tests/unit/wallClockParity.test.ts enforces that.
BEGIN;
SELECT plan(14);

SELECT is(
  to_char((v.wall_clock::timestamp AT TIME ZONE v.tz) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  v.expected_instant,
  format('%s in %s is %s', v.wall_clock, v.tz, v.expected_instant)
)
FROM (VALUES
  ('2026-11-01T01:30', 'America/Chicago',  '2026-11-01T07:30:00.000Z'),
  ('2026-03-08T02:30', 'America/Chicago',  '2026-03-08T08:30:00.000Z'),
  ('2026-04-05T02:30', 'Australia/Sydney', '2026-04-04T16:30:00.000Z'),
  ('2026-10-04T02:30', 'Australia/Sydney', '2026-10-03T16:30:00.000Z'),
  ('2026-07-22T20:56', 'America/Chicago',  '2026-07-23T01:56:00.000Z'),
  ('2026-06-15T10:00', 'Australia/Sydney', '2026-06-15T00:00:00.000Z'),
  ('2026-03-08T03:30', 'America/Chicago',  '2026-03-08T08:30:00.000Z'),
  ('2026-11-01T00:30', 'America/Chicago',  '2026-11-01T05:30:00.000Z'),
  ('2026-10-04T03:30', 'Australia/Sydney', '2026-10-03T16:30:00.000Z'),
  ('2026-04-05T01:30', 'Australia/Sydney', '2026-04-04T14:30:00.000Z'),
  ('2026-10-25T01:30', 'Europe/Dublin',    '2026-10-25T01:30:00.000Z'),
  ('2026-03-29T01:30', 'Europe/Dublin',    '2026-03-29T01:30:00.000Z'),
  ('2026-04-05T01:45', 'Australia/Lord_Howe', '2026-04-04T15:15:00.000Z'),
  ('2026-10-04T02:15', 'Australia/Lord_Howe', '2026-10-03T15:45:00.000Z')
) AS v(wall_clock, tz, expected_instant);

SELECT * FROM finish();
ROLLBACK;
