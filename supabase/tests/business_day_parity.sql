-- Asserts Postgres agrees with src/lib/restaurantClock.ts::toBusinessDay.
-- Rows MUST match tests/fixtures/businessDayFixtures.ts exactly;
-- tests/unit/businessDayParity.test.ts enforces that.
BEGIN;
SELECT plan(10);

SELECT is(
  (v.instant::timestamptz AT TIME ZONE v.tz)::date::text,
  v.expected_day,
  format('%s in %s is %s', v.instant, v.tz, v.expected_day)
)
FROM (VALUES
  ('2026-07-23T01:56:20Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-23T04:59:00Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-23T05:00:00Z', 'America/Chicago',  '2026-07-23'),
  ('2026-07-22T13:00:00Z', 'Pacific/Auckland', '2026-07-23'),
  ('2026-03-08T07:30:00Z', 'America/Chicago',  '2026-03-08'),
  ('2026-03-08T08:30:00Z', 'America/Chicago',  '2026-03-08'),
  ('2026-11-01T06:30:00Z', 'America/Chicago',  '2026-11-01'),
  ('2026-11-01T07:30:00Z', 'America/Chicago',  '2026-11-01'),
  ('2026-07-22T10:00:00Z', 'America/Chicago',  '2026-07-22'),
  ('2026-07-22T18:45:00Z', 'Asia/Kolkata',     '2026-07-23')
) AS v(instant, tz, expected_day);

SELECT * FROM finish();
ROLLBACK;
