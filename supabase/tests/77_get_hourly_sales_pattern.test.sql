-- ============================================================================
-- Test: public.get_hourly_sales_pattern(uuid, date, date, integer, text)
--
-- Design: docs/superpowers/specs/2026-09-27-connector-hourly-sales-design.md
-- Plan:   docs/superpowers/plans/2026-09-27-connector-hourly-sales-plan.md
--
-- RED: this file must fail. The function does not exist yet.
-- ============================================================================

BEGIN;
SELECT plan(29);

-- Fixed identities for this test.
-- restaurant A: 00000000-0000-0000-0000-0000000000a1 (America/Chicago)
-- restaurant B: 00000000-0000-0000-0000-0000000000b1 (bad zone 'Not/AZone')
-- member:       00000000-0000-0000-0000-000000000001 (member of A and B)
-- non-member:   99999999-9999-9999-9999-999999999999

SET LOCAL role TO postgres;

-- user_restaurants.user_id has an FK to auth.users(id). Seed both users first.
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000001', 'hourly-sales-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO auth.users (id, email)
VALUES ('99999999-9999-9999-9999-999999999999', 'hourly-sales-nonmember@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, timezone)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'Hourly Sales Test Diner A', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO restaurants (id, name, timezone)
VALUES ('00000000-0000-0000-0000-0000000000b1', 'Hourly Sales Test Diner B', 'Not/AZone')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ---------------------------------------------------------------------------
-- Fixture rows for restaurant A, window 2026-09-01..2026-09-30.
-- unified_sales requires pos_system, external_order_id, item_name (NOT NULL).
-- A partial unique index forces a distinct external_order_id per row with
-- parent_sale_id IS NULL.
-- ---------------------------------------------------------------------------

-- Monday slot 960 (16:00-17:00 local), case 6: 4 Mondays, 2 with a row in
-- slot 960. Case 7: a child row and a discount row on the same Monday, both
-- must be skipped.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-1', 'Test Item', '2026-09-07', '16:15:00', NULL, 40, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-1-child', 'Test Item Child', '2026-09-07', '16:15:00', NULL, 500, 'sale',
        'aaaaaaaa-0000-0000-0000-000000000001', NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-1-discount', 'Test Item Discount', '2026-09-07', '16:15:00', NULL, 500, 'discount', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-2', 'Test Item', '2026-09-14', '16:45:00', NULL, 60, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000005', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-3', 'Test Item', '2026-09-21', '10:00:00', NULL, 20, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-mon-4', 'Test Item', '2026-09-28', '11:00:00', NULL, 25, 'sale', NULL, NULL);

-- Tuesday fallback (case 8, 9): no sold_at, no sale_time.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000007', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-tue-1', 'Test Item', '2026-09-01', NULL, NULL, 130, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000008', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-tue-2', 'Test Item', '2026-09-08', NULL, NULL, 170, 'sale', NULL, NULL);

-- Wednesday slot 600 (10:00), case 13: negative half average rounds away
-- from zero.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-wed-1', 'Test Item', '2026-09-02', '10:00:00', NULL, -0.01, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-wed-2', 'Test Item', '2026-09-09', '10:00:00', NULL, 0.00, 'sale', NULL, NULL);

-- Wednesday case 4: one row at 16:40, no sold_at.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-wed-3', 'Test Item', '2026-09-16', '16:40:00', NULL, 44, 'sale', NULL, NULL);

-- Wednesday case 5: two rows the same date, 16:20 and 16:40.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-wed-4a', 'Test Item', '2026-09-23', '16:20:00', NULL, 11, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-wed-4b', 'Test Item', '2026-09-23', '16:40:00', NULL, 22, 'sale', NULL, NULL);

-- Sunday case 3: sale_date 2026-09-13, sold_at 2026-09-14T03:30:00Z, which is
-- 2026-09-13 22:30 local (America/Chicago, CDT). day_of_week must come from
-- sale_date (0), and the slot from the LOCAL hour (1350), not the UTC hour
-- (210).
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-sun-1', 'Test Item', '2026-09-13', NULL, '2026-09-14T03:30:00+00', 77, 'sale', NULL, NULL);

-- DST fixture, case 11: 2026-11-01 is the fall-back Sunday. Both UTC
-- timestamps read as 01:30 local (once CDT, once CST) and must land in the
-- same slot and count as one sample date.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-dst-1', 'Test Item', '2026-11-01', NULL, '2026-11-01T06:30:00+00', 15, 'sale', NULL, NULL);
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000010', '00000000-0000-0000-0000-0000000000a1',
        'manual', 'hs-dst-2', 'Test Item', '2026-11-01', NULL, '2026-11-01T07:30:00+00', 25, 'sale', NULL, NULL);

-- ---------------------------------------------------------------------------
-- Test 1: access guard (unauthenticated / non-member caller).
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
SET LOCAL role = authenticated;

SELECT throws_ok(
  $$SELECT get_hourly_sales_pattern('00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-02'::date)$$,
  'Access denied to restaurant',
  'a non-member caller gets Access denied to restaurant'
);

-- ---------------------------------------------------------------------------
-- Act as the member for every remaining call.
-- ---------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
SET LOCAL role = authenticated;

-- ---------------------------------------------------------------------------
-- Test 2-5: argument validation, SQLSTATE 22023.
-- ---------------------------------------------------------------------------
SELECT throws_ok(
  $$SELECT get_hourly_sales_pattern('00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-02'::date, 45, 'weekday')$$,
  '22023',
  'a bad interval_minutes (45) raises SQLSTATE 22023'
);

SELECT throws_ok(
  $$SELECT get_hourly_sales_pattern('00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-02'::date, 60, 'x')$$,
  '22023',
  'a bad view (x) raises SQLSTATE 22023'
);

SELECT throws_ok(
  $$SELECT get_hourly_sales_pattern('00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-10'::date, '2026-09-01'::date)$$,
  '22023',
  'reversed dates (end before start) raise SQLSTATE 22023'
);

SELECT throws_ok(
  $$SELECT get_hourly_sales_pattern('00000000-0000-0000-0000-0000000000a1'::uuid, '2026-01-01'::date, '2027-01-03'::date)$$,
  '22023',
  'a 367-day span raises SQLSTATE 22023'
);

-- ---------------------------------------------------------------------------
-- Test 6-7: case 3, local hour not UTC hour, weekday from sale_date.
-- interval_minutes = 30 so the local slot (1350) and the UTC slot (210) are
-- distinguishable.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-30'::date, 30, 'weekday'
) AS r_case3 \gset

SELECT ok(
  (SELECT count(*)::int FROM jsonb_array_elements(:'r_case3'::jsonb->'days') d
   WHERE (d->>'day_of_week')::int = 0
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 1350)) = 1,
  'sold_at 03:30Z (22:30 local) lands in slot 1350 on day_of_week 0'
);

SELECT ok(
  (SELECT count(*)::int FROM jsonb_array_elements(:'r_case3'::jsonb->'days') d
   WHERE (d->>'day_of_week')::int = 0
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 210)) = 0,
  'sold_at 03:30Z does not land in slot 210 (the UTC hour)'
);

-- ---------------------------------------------------------------------------
-- Test 8-9: case 4, sale_time 16:40 at interval 30 and 60.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-16'::date, '2026-09-16'::date, 30, 'weekday'
) AS r_case4_30 \gset

SELECT is(
  (SELECT (s->>'start_minute')::int FROM jsonb_array_elements(:'r_case4_30'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s LIMIT 1),
  990, 'sale_time 16:40 lands in slot 990 at interval_minutes = 30'
);

SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-16'::date, '2026-09-16'::date, 60, 'weekday'
) AS r_case4_60 \gset

SELECT is(
  (SELECT (s->>'start_minute')::int FROM jsonb_array_elements(:'r_case4_60'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s LIMIT 1),
  960, 'sale_time 16:40 lands in slot 960 at interval_minutes = 60'
);

-- ---------------------------------------------------------------------------
-- Test 10-11: case 5, 16:20 and 16:40 at interval 30 give two slots.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-23'::date, '2026-09-23'::date, 30, 'weekday'
) AS r_case5 \gset

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_case5'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 960),
  11::numeric, '16:20 lands in slot 960 at interval_minutes = 30'
);

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_case5'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 990),
  22::numeric, '16:40 lands in slot 990 at interval_minutes = 30'
);

-- ---------------------------------------------------------------------------
-- Test 12-13: case 6/7, Monday average over 4 dates, child and discount rows
-- skipped, at interval 60.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-30'::date, 60, 'weekday'
) AS r_main60 \gset

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_main60'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s
   WHERE (d->>'day_of_week')::int = 1 AND (s->>'start_minute')::int = 960),
  50::numeric,
  'Monday slot 960 averages 40+60 over 2 sample dates (child/discount excluded)'
);

SELECT is(
  (SELECT (s->>'sample_count')::int FROM jsonb_array_elements(:'r_main60'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s
   WHERE (d->>'day_of_week')::int = 1 AND (s->>'start_minute')::int = 960),
  2, 'Monday slot 960 sample_count is 2'
);

-- ---------------------------------------------------------------------------
-- Test 14-17: case 8, Tuesday fallback (no sold_at, no sale_time), interval
-- 60 and 30.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT jsonb_array_length(d->'slots') FROM jsonb_array_elements(:'r_main60'::jsonb->'days') d
   WHERE (d->>'day_of_week')::int = 2),
  13, 'Tuesday fallback has 13 slots at interval_minutes = 60'
);

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_main60'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s
   WHERE (d->>'day_of_week')::int = 2 AND (s->>'start_minute')::int = 600),
  11.54::numeric, 'Tuesday fallback value is day_total_avg / 13, rounded to 2 decimals'
);

SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-30'::date, 30, 'weekday'
) AS r_main30 \gset

SELECT is(
  (SELECT jsonb_array_length(d->'slots') FROM jsonb_array_elements(:'r_main30'::jsonb->'days') d
   WHERE (d->>'day_of_week')::int = 2),
  26, 'Tuesday fallback has 26 slots at interval_minutes = 30'
);

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_main30'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s
   WHERE (d->>'day_of_week')::int = 2 AND (s->>'start_minute')::int = 540),
  5.77::numeric, 'Tuesday fallback value is day_total_avg / 26, rounded to 2 decimals'
);

-- ---------------------------------------------------------------------------
-- Test 18-23: case 9, by_date view.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-07'::date, '2026-09-07'::date, 60, 'by_date'
) AS r_bydate_slot \gset

SELECT is(
  (SELECT (d->>'day_total')::numeric FROM jsonb_array_elements(:'r_bydate_slot'::jsonb->'days') d),
  40::numeric, 'by_date day_total for 2026-09-07 excludes the child and discount rows'
);

SELECT is(
  (SELECT (d->>'has_hourly_breakdown')::boolean FROM jsonb_array_elements(:'r_bydate_slot'::jsonb->'days') d),
  true, 'by_date has_hourly_breakdown is true for 2026-09-07'
);

SELECT is(
  (SELECT (s->>'sample_count')::int FROM jsonb_array_elements(:'r_bydate_slot'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 960),
  1, 'by_date sample_count is 1 for an actual date'
);

SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-09-01'::date, '2026-09-01'::date, 60, 'by_date'
) AS r_bydate_noslot \gset

SELECT is(
  (SELECT (d->>'day_total')::numeric FROM jsonb_array_elements(:'r_bydate_noslot'::jsonb->'days') d),
  130::numeric, 'by_date day_total for 2026-09-01 includes the row without a slot'
);

SELECT is(
  (SELECT jsonb_array_length(d->'slots') FROM jsonb_array_elements(:'r_bydate_noslot'::jsonb->'days') d),
  0, 'by_date slots is empty for a date with no slot-bearing row'
);

SELECT is(
  (SELECT (d->>'has_hourly_breakdown')::boolean FROM jsonb_array_elements(:'r_bydate_noslot'::jsonb->'days') d),
  false, 'by_date has_hourly_breakdown is false for a date with no slot-bearing row'
);

-- ---------------------------------------------------------------------------
-- Test 24: case 10, total_sales over the whole window.
-- ---------------------------------------------------------------------------
SELECT is(
  (:'r_main60'::jsonb->>'total_sales')::numeric,
  598.99::numeric,
  'total_sales sums every row in the window (excludes child and discount rows)'
);

-- ---------------------------------------------------------------------------
-- Test 25-26: case 11, DST fall-back: two UTC instants, one local slot, one
-- sample date.
-- ---------------------------------------------------------------------------
SELECT get_hourly_sales_pattern(
  '00000000-0000-0000-0000-0000000000a1'::uuid, '2026-11-01'::date, '2026-11-01'::date, 60, 'weekday'
) AS r_dst \gset

SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_dst'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 60),
  40::numeric, 'DST fall-back: both 01:30 instants sum into slot 60'
);

SELECT is(
  (SELECT (s->>'sample_count')::int FROM jsonb_array_elements(:'r_dst'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s WHERE (s->>'start_minute')::int = 60),
  1, 'DST fall-back: both rows share one sale_date, so sample_count is 1'
);

-- ---------------------------------------------------------------------------
-- Test 27: case 12, restaurant B has an invalid timezone, falls back to
-- America/Chicago.
-- ---------------------------------------------------------------------------
SELECT is(
  (get_hourly_sales_pattern(
    '00000000-0000-0000-0000-0000000000b1'::uuid, '2026-09-01'::date, '2026-09-01'::date
  )->>'time_zone'),
  'America/Chicago',
  'restaurant B (Not/AZone) falls back to America/Chicago'
);

-- ---------------------------------------------------------------------------
-- Test 28: case 13, round(numeric, 2) rounds a negative half away from zero.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (s->>'sales')::numeric FROM jsonb_array_elements(:'r_main60'::jsonb->'days') d,
   jsonb_array_elements(d->'slots') s
   WHERE (d->>'day_of_week')::int = 3 AND (s->>'start_minute')::int = 600),
  -0.01::numeric,
  'a negative half average (-0.005) rounds to -0.01'
);

-- ---------------------------------------------------------------------------
-- Test 29: case 14, anon cannot execute the RPC.
-- ---------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon',
    'public.get_hourly_sales_pattern(uuid, date, date, integer, text)', 'EXECUTE'),
  'anon cannot execute get_hourly_sales_pattern'
);

SELECT * FROM finish();
ROLLBACK;
