-- Business-day cutoff: helper semantics, DST, and constraint boundaries.
BEGIN;
SELECT plan(21);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Three restaurants: Chicago at cutoff 2, Chicago at cutoff 0, and one with a
-- deliberately invalid timezone string to exercise the exception probe.
INSERT INTO public.restaurants (id, name, timezone, business_day_start_hour)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Cutoff 2 Chicago', 'America/Chicago', 2),
  ('22222222-2222-2222-2222-222222222222', 'Cutoff 0 Chicago', 'America/Chicago', 0),
  ('33333333-3333-3333-3333-333333333333', 'Bad TZ',           'Not/AZone',       2),
  ('44444444-4444-4444-4444-444444444444', 'Empty TZ',         '',                2);

-- ── Existence ───────────────────────────────────────────────────────────────
SELECT has_column('public', 'restaurants', 'business_day_start_hour',
  'restaurants.business_day_start_hour exists');
SELECT col_not_null('public', 'restaurants', 'business_day_start_hour',
  'business_day_start_hour is NOT NULL');
SELECT col_default_is('public', 'restaurants', 'business_day_start_hour', '0',
  'business_day_start_hour defaults to 0 (behavior-preserving)');
SELECT has_function('public', 'business_day', ARRAY['timestamp with time zone','uuid'],
  'public.business_day(timestamptz, uuid) exists');

-- ── Core cutoff behavior (design section 4, the worked table) ────────────────
-- 18:00 local clock-in, cutoff 2 -> its own day.
SELECT is(
  public.business_day('2026-07-28 23:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-28'::date,
  '18:00 CDT clock-in at cutoff 2 stays on its own day');

-- 01:00 local clock-in, cutoff 2 -> PREVIOUS day. This is the feature.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-28'::date,
  '01:00 CDT clock-in at cutoff 2 rolls back to the previous business day');

-- 03:00 local clock-in is past the cutoff -> its own day.
SELECT is(
  public.business_day('2026-07-29 08:00:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-07-29'::date,
  '03:00 CDT clock-in at cutoff 2 belongs to its own day');

-- cutoff 0 degenerates to the restaurant-local calendar day.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '22222222-2222-2222-2222-222222222222'),
  '2026-07-29'::date,
  'cutoff 0 == restaurant-local calendar day');

-- ── The section 4.1 anti-regression pair ────────────────────────────────────
-- Inside the fall-back repeated hour: 07:30 UTC is the SECOND 01:30 CST.
SELECT is(
  public.business_day('2026-11-01 07:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-10-31'::date,
  'fall-back repeated hour buckets to the previous business day');

-- ...and the tempting "equivalent" ordering is provably WRONG here. Without
-- this assertion a maintainer could "simplify" business_day() to the rejected
-- form and still pass every other test in this file, because the two orderings
-- agree everywhere outside the repeated hour.
SELECT isnt(
  (('2026-11-01 07:30:00+00'::timestamptz - make_interval(hours => 2))
     AT TIME ZONE 'America/Chicago')::date,
  '2026-10-31'::date,
  'subtract-BEFORE-convert gives the WRONG day here -- see design section 4.1');

-- ── DST transitions ─────────────────────────────────────────────────────────
-- Fall-back, after the transition completes: 02:30 CST.
SELECT is(
  public.business_day('2026-11-01 08:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-11-01'::date,
  'fall-back after transition, 02:30 CST is past the cutoff');

-- Spring-forward: 02:00-03:00 local does not exist. 09:30 UTC is 03:30 CDT.
SELECT is(
  public.business_day('2026-03-08 09:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-03-08'::date,
  'spring-forward 03:30 CDT is past the cutoff');

-- Spring-forward, before the skip: 01:30 CST -> previous day at cutoff 2.
SELECT is(
  public.business_day('2026-03-08 07:30:00+00'::timestamptz,
                      '11111111-1111-1111-1111-111111111111'),
  '2026-03-07'::date,
  'spring-forward 01:30 CST rolls back');

-- ── Degenerate inputs ───────────────────────────────────────────────────────
SELECT is(
  public.business_day(NULL::timestamptz, '11111111-1111-1111-1111-111111111111'),
  NULL::date,
  'NULL instant returns NULL');

SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '33333333-3333-3333-3333-333333333333'),
  '2026-07-29'::date,
  'invalid IANA string falls back to UTC (06:00 UTC, cutoff 2 -> 04:00 -> Jul 29)');

SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '44444444-4444-4444-4444-444444444444'),
  '2026-07-29'::date,
  'empty-string timezone falls back to UTC');

-- Missing restaurant: contract is UTC/0, NOT null and NOT an error. Under
-- SECURITY INVOKER this is the same code path an RLS-invisible row takes.
SELECT is(
  public.business_day('2026-07-29 06:00:00+00'::timestamptz,
                      '99999999-9999-9999-9999-999999999999'),
  '2026-07-29'::date,
  'unknown restaurant_id resolves to UTC/cutoff-0 rather than NULL or an error');

-- ── CHECK boundaries, BOTH directions ───────────────────────────────────────
-- Rejections alone would still pass against a constraint accidentally
-- tightened to BETWEEN 1 AND 10, which would lock out the 0 default every
-- existing row depends on.
SELECT throws_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = -1
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', NULL, 'cutoff -1 is rejected');

SELECT throws_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 12
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  '23514', NULL, 'cutoff 12 is rejected');

SELECT lives_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 0
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  'cutoff 0 is accepted (the default every existing row uses)');

SELECT lives_ok(
  $$UPDATE public.restaurants SET business_day_start_hour = 11
    WHERE id = '22222222-2222-2222-2222-222222222222'$$,
  'cutoff 11 is accepted (upper bound)');

SELECT * FROM finish();
ROLLBACK;
