-- pgTAP tests for get_sales_daily_series(p_restaurant_id, p_start_date, p_end_date, p_time_zone, p_include_hours)
-- Design: docs/superpowers/specs/2026-11-22-sales-daily-series-rpc-design.md
-- Design (by_hour): docs/superpowers/specs/2026-11-22-sales-hourly-comparison-design.md
--
-- The function must return the same `pos_systems` and `by_day` as
-- get_sales_trends for the same restaurant and range. It must not show rows
-- of another restaurant. It must refuse a non-member and a NULL date. It has
-- no range cap, the same as get_sales_trends.
--
-- Restaurant A (...0199) is the member restaurant. Restaurant B (...0198)
-- belongs to another user. Its rows use pos_system 'clover', so a leak is
-- easy to see.
BEGIN;
SELECT plan(36);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000011"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000011'::uuid, 'series-member-a@example.com'),
  ('00000000-0000-0000-0000-000000000012'::uuid, 'series-member-b@example.com'),
  ('00000000-0000-0000-0000-000000000013'::uuid, 'series-nonmember@example.com'),
  ('00000000-0000-0000-0000-000000000014'::uuid, 'series-staff-a@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone, timezone) VALUES
  ('00000000-0000-0000-0000-000000000199'::uuid, 'Series Test A', '1 Series Ave', '555-0199', 'America/Chicago'),
  ('00000000-0000-0000-0000-000000000198'::uuid, 'Series Test B', '2 Series Ave', '555-0198', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000011'::uuid, '00000000-0000-0000-0000-000000000199'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000012'::uuid, '00000000-0000-0000-0000-000000000198'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000014'::uuid, '00000000-0000-0000-0000-000000000199'::uuid, 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ============================================================
-- Fixture rows
-- ============================================================
-- Restaurant A, 2024-08-01..2024-08-03:
--   08-01 toast:  t-1 (20 + 5, one order with two items) + t-2 (10) = 35.00, 2 orders
--   08-01 square: sq-1 (8)                                         =  8.00, 1 order
--   08-02 toast:  t-3 (15) + t-4 (3) + t-5 (2)                     = 20.00, 3 orders
--   08-03 toast:  t-6 (40)                                         = 40.00, 1 order
-- Excluded rows on 08-01: tip, tax, void, discount, and a child split.
-- Two more excluded rows each fail only one predicate, so each predicate has
-- its own row:
--   1ff: item_type 'tip', adjustment_type NULL     -> only item_type = 'sale' excludes it
--   200: item_type 'sale', adjustment_type 'service_charge' -> only adjustment_type IS NULL excludes it
-- Restaurant A, 2024-09-01: toast 10.00 and square 10.00 (a revenue tie).
-- Restaurant B: one clover row of 500.00 on 08-01.
--
-- Not tested, because the schema blocks them: external_order_id is NOT NULL
-- (20250925125415), so the COALESCE(external_order_id, id::text) fallback
-- cannot run. total_price is NUMERIC(10,2), so ROUND(rev, 2) never changes a
-- value.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price,
  sale_date, sale_time, sold_at, item_type, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-0000000001f1'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Burger',2,20.00,'2024-08-01',NULL,'2024-08-01T19:30:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f2'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Fries',1,5.00,'2024-08-01',NULL,'2024-08-01T19:35:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f3'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-2','Burger',1,10.00,'2024-08-01',NULL,'2024-08-01T23:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f4'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'square','sq-1','Burger',1,8.00,'2024-08-01',NULL,'2024-08-01T20:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f5'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-3','Burger',1,15.00,'2024-08-02',NULL,'2024-08-02T19:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f6'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-4','Soda',1,3.00,'2024-08-02','10:15:00'::time,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f7'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-5','Water',1,2.00,'2024-08-02',NULL,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f8'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-6','Steak',1,40.00,'2024-08-03',NULL,'2024-08-02T23:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001f9'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Tip',1,5.00,'2024-08-01',NULL,NULL,'tip','tip',NULL),
  ('00000000-0000-0000-0000-0000000001fa'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Tax',1,3.00,'2024-08-01',NULL,NULL,'tax','tax',NULL),
  ('00000000-0000-0000-0000-0000000001fb'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Void - Burger',1,-10.00,'2024-08-01',NULL,NULL,'discount','void',NULL),
  ('00000000-0000-0000-0000-0000000001fc'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Discount - Burger',1,-2.00,'2024-08-01',NULL,NULL,'discount','discount',NULL),
  ('00000000-0000-0000-0000-0000000001fd'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Burger',1,999.00,'2024-08-01',NULL,NULL,'sale',NULL,'00000000-0000-0000-0000-0000000001f1'::uuid),
  ('00000000-0000-0000-0000-0000000001ff'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Tip line',1,77.00,'2024-08-01',NULL,NULL,'tip',NULL,NULL),
  ('00000000-0000-0000-0000-000000000200'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-1','Service charge',1,88.00,'2024-08-01',NULL,NULL,'sale','service_charge',NULL),
  ('00000000-0000-0000-0000-000000000201'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'toast','t-7','Burger',1,10.00,'2024-09-01',NULL,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-000000000202'::uuid,'00000000-0000-0000-0000-000000000199'::uuid,'square','sq-2','Burger',1,10.00,'2024-09-01',NULL,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000001fe'::uuid,'00000000-0000-0000-0000-000000000198'::uuid,'clover','cl-1','Lobster',1,500.00,'2024-08-01',NULL,'2024-08-01T20:00:00+00'::timestamptz,'sale',NULL,NULL)
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id, pos_system = EXCLUDED.pos_system,
  external_order_id = EXCLUDED.external_order_id, item_name = EXCLUDED.item_name,
  quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, sale_date = EXCLUDED.sale_date,
  sale_time = EXCLUDED.sale_time, sold_at = EXCLUDED.sold_at, item_type = EXCLUDED.item_type,
  adjustment_type = EXCLUDED.adjustment_type, parent_sale_id = EXCLUDED.parent_sale_id;

-- ============================================================
-- Tests 1-4: signature, security model, grants
-- ============================================================
SELECT has_function(
  'public', 'get_sales_daily_series', ARRAY['uuid', 'date', 'date', 'text', 'boolean'],
  'get_sales_daily_series(uuid, date, date, text, boolean) exists'
);

SELECT is(
  (SELECT p.prosecdef FROM pg_proc p
   WHERE p.oid = 'public.get_sales_daily_series(uuid, date, date, text, boolean)'::regprocedure),
  true,
  'get_sales_daily_series is SECURITY DEFINER, like get_sales_trends'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_sales_daily_series(uuid, date, date, text, boolean)', 'EXECUTE'),
  'authenticated can execute get_sales_daily_series'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_sales_daily_series(uuid, date, date, text, boolean)', 'EXECUTE'),
  'anon cannot execute get_sales_daily_series'
);

-- ============================================================
-- Tests 5-6: access check and tenant isolation
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000013"}';
SELECT throws_ok(
  $$ SELECT get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03') $$,
  'Access denied to restaurant',
  'non-member call raises Access denied'
);

-- Member of A asks for B.
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000011"}';
SELECT throws_ok(
  $$ SELECT get_sales_daily_series('00000000-0000-0000-0000-000000000198'::uuid,'2024-08-01','2024-08-03') $$,
  'Access denied to restaurant',
  'member of restaurant A cannot read restaurant B'
);

-- ============================================================
-- Tests 7-10: parity with get_sales_trends and pinned values
-- ============================================================
SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'by_day',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'by_day',
  'by_day equals the get_sales_trends by_day for the same seed and range'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'pos_systems',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'pos_systems',
  'pos_systems equals the get_sales_trends pos_systems for the same seed and range'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'by_day',
  '[
    {"sale_date": "2024-08-01", "pos_system": "square", "revenue": 8.00,  "orders": 1},
    {"sale_date": "2024-08-01", "pos_system": "toast",  "revenue": 35.00, "orders": 2},
    {"sale_date": "2024-08-02", "pos_system": "toast",  "revenue": 20.00, "orders": 3},
    {"sale_date": "2024-08-03", "pos_system": "toast",  "revenue": 40.00, "orders": 1}
  ]'::jsonb,
  'by_day has the pinned totals, sorted by date then POS, with exclusion rows left out'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'pos_systems',
  '["toast", "square"]'::jsonb,
  'pos_systems is sorted by revenue, highest first'
);

-- Test 10b: a revenue tie sorts by pos_system name. No parity check here,
-- because get_sales_trends has no tie-break.
SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-09-01','2024-09-01')->'pos_systems',
  '["square", "toast"]'::jsonb,
  'pos_systems sorts a revenue tie by pos_system name'
);

-- ============================================================
-- Test 11: the result has only the two keys
-- ============================================================
SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')
  ) k),
  ARRAY['by_day', 'pos_systems'],
  'result has only by_day and pos_systems'
);

-- ============================================================
-- Test 12: tenant isolation in the data (B row does not leak into A)
-- ============================================================
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'by_day'
  ) e WHERE e->>'pos_system' = 'clover'),
  0,
  'rows of restaurant B do not appear in the restaurant A series'
);

-- Test 13: B member sees the B row (the fixture row is real, so test 12 is meaningful)
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000012"}';
SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000198'::uuid,'2024-08-01','2024-08-03')->'by_day',
  '[{"sale_date": "2024-08-01", "pos_system": "clover", "revenue": 500.00, "orders": 1}]'::jsonb,
  'member of restaurant B sees only the B series'
);
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000011"}';

-- ============================================================
-- Tests 14-15: empty ranges
-- ============================================================
SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2023-01-01','2023-01-31'),
  '{"pos_systems": [], "by_day": []}'::jsonb,
  'a range with no sales returns empty arrays'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-03','2024-08-01'),
  '{"pos_systems": [], "by_day": []}'::jsonb,
  'an end date before the start date returns empty arrays'
);

-- ============================================================
-- Tests 16-19: required dates, and no range cap
-- ============================================================
SELECT throws_ok(
  $$ SELECT get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid, NULL, '2024-08-03') $$,
  '22023',
  NULL,
  'a NULL start date raises invalid_parameter_value'
);

SELECT throws_ok(
  $$ SELECT get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid, '2024-08-01', NULL) $$,
  '22023',
  NULL,
  'a NULL end date raises invalid_parameter_value'
);

-- 2020-01-01 .. 2026-12-31 is longer than two years. The old prior query
-- (get_sales_trends) accepted it, so this function must accept it too.
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid, '2020-01-01', '2026-12-31')->'by_day'
  )),
  6,
  'a range longer than two years is allowed and includes the fixture days'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid, '2020-01-01', '2026-12-31')->'by_day',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid, '2020-01-01', '2026-12-31')->'by_day',
  'by_day equals get_sales_trends by_day for a long range'
);

-- ============================================================
-- Tests 20-24: index, role scope, no auth.uid(), grants, search_path
-- has_index checks only that the index exists. A plan check (EXPLAIN) depends
-- on table statistics and is not stable in a test transaction.
-- ============================================================
SELECT has_index(
  'public', 'unified_sales', 'idx_unified_sales_restaurant_keyset',
  ARRAY['restaurant_id', 'sale_date', 'created_at', 'id'],
  'the (restaurant_id, sale_date, ...) index for the range scan exists'
);

-- Any member can read sales, the same as get_sales_trends. The check does not read role.
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000014"}';
SELECT is(
  jsonb_array_length(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03')->'by_day'
  ),
  4,
  'a staff member of restaurant A can read the A series'
);

-- No JWT subject: auth.uid() is NULL, so the membership check fails.
SET LOCAL "request.jwt.claims" TO '{}';
SELECT throws_ok(
  $$ SELECT get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03') $$,
  'Access denied to restaurant',
  'a call with no auth.uid() raises Access denied'
);

SELECT ok(
  NOT has_function_privilege('public', 'public.get_sales_daily_series(uuid, date, date, text, boolean)', 'EXECUTE'),
  'PUBLIC has no EXECUTE grant'
);

SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY(proconfig)
     FROM pg_proc WHERE oid = 'public.get_sales_daily_series(uuid, date, date, text, boolean)'::regprocedure),
  'search_path is pinned to public, pg_temp'
);

-- ============================================================
-- Tests 26-36: the optional by_hour section
-- Hour buckets of the fixture, America/Chicago (CDT, UTC-5):
--   1f1, 1f2 (08-01 19:30Z, 19:35Z) -> 14 toast; 1f5 (08-02 19:00Z) -> 14 toast
--   1f3 (08-01 23:00Z) -> 18 toast; 1f8 (sale_date 08-03, sold_at 08-02 23:00Z) -> 18 toast
--   1f4 (08-01 20:00Z) -> 15 square
--   1f6 (no sold_at, sale_time 10:15) -> 10 toast (the sale_time fallback)
--   1f7 (no sold_at, no sale_time) -> no bucket, not in by_hour
-- In UTC the sold_at rows move to 19, 20, and 23. 1f6 stays at 10.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000011"}';

SELECT hasnt_function(
  'public', 'get_sales_daily_series', ARRAY['uuid', 'date', 'date'],
  'the 3-argument overload is dropped, so a named 3-argument call is not ambiguous'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',true)->'by_hour',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago')->'by_hour',
  'by_hour equals the get_sales_trends by_hour for America/Chicago'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',true)->'by_hour',
  '[
    {"hour": 10, "pos_system": "toast",  "revenue": 3.00,  "day_count": 1},
    {"hour": 14, "pos_system": "toast",  "revenue": 40.00, "day_count": 2},
    {"hour": 15, "pos_system": "square", "revenue": 8.00,  "day_count": 1},
    {"hour": 18, "pos_system": "toast",  "revenue": 50.00, "day_count": 2}
  ]'::jsonb,
  'by_hour has the pinned buckets: sold_at in the time zone, else sale_time, else left out'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','UTC',true)->'by_hour',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','UTC')->'by_hour',
  'by_hour equals the get_sales_trends by_hour for UTC'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','UTC',true)->'by_hour',
  '[
    {"hour": 10, "pos_system": "toast",  "revenue": 3.00,  "day_count": 1},
    {"hour": 19, "pos_system": "toast",  "revenue": 40.00, "day_count": 2},
    {"hour": 20, "pos_system": "square", "revenue": 8.00,  "day_count": 1},
    {"hour": 23, "pos_system": "toast",  "revenue": 50.00, "day_count": 2}
  ]'::jsonb,
  'p_time_zone moves the sold_at buckets and does not move the sale_time bucket'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03',NULL,true)->'by_hour',
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',true)->'by_hour',
  'a NULL p_time_zone falls back to America/Chicago, the same as get_sales_trends'
);

SELECT is(
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',true)
  ) k),
  ARRAY['by_day', 'by_hour', 'pos_systems'],
  'p_include_hours = true adds only the by_hour key'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',false),
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03'),
  'p_include_hours = false gives the same payload as the default call'
);

SELECT is(
  get_sales_daily_series(
    p_restaurant_id => '00000000-0000-0000-0000-000000000199'::uuid,
    p_start_date => '2024-08-01', p_end_date => '2024-08-03', p_include_hours => NULL
  ) ? 'by_hour',
  false,
  'a NULL p_include_hours leaves out by_hour'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2023-01-01','2023-01-31','America/Chicago',true),
  '{"pos_systems": [], "by_day": [], "by_hour": []}'::jsonb,
  'a range with no sales and hours requested returns three empty arrays'
);

SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(
    get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid,'2024-08-01','2024-08-03','America/Chicago',true)->'by_hour'
  ) e WHERE e->>'pos_system' = 'clover'),
  0,
  'rows of restaurant B do not appear in the restaurant A by_hour'
);

SELECT * FROM finish();
ROLLBACK;
