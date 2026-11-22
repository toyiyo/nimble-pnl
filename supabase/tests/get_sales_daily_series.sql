-- pgTAP tests for get_sales_daily_series(p_restaurant_id, p_start_date, p_end_date)
-- Design: docs/superpowers/specs/2026-11-22-sales-daily-series-rpc-design.md
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
SELECT plan(24);

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
-- Restaurant B: one clover row of 500.00 on 08-01.
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
  'public', 'get_sales_daily_series', ARRAY['uuid', 'date', 'date'],
  'get_sales_daily_series(uuid, date, date) exists'
);

SELECT is(
  (SELECT p.prosecdef FROM pg_proc p
   WHERE p.oid = 'public.get_sales_daily_series(uuid, date, date)'::regprocedure),
  true,
  'get_sales_daily_series is SECURITY DEFINER, like get_sales_trends'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_sales_daily_series(uuid, date, date)', 'EXECUTE'),
  'authenticated can execute get_sales_daily_series'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.get_sales_daily_series(uuid, date, date)', 'EXECUTE'),
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
  4,
  'a range longer than two years is allowed and includes the fixture days'
);

SELECT is(
  get_sales_daily_series('00000000-0000-0000-0000-000000000199'::uuid, '2020-01-01', '2026-12-31')->'by_day',
  get_sales_trends('00000000-0000-0000-0000-000000000199'::uuid, '2020-01-01', '2026-12-31')->'by_day',
  'by_day equals get_sales_trends by_day for a long range'
);

-- ============================================================
-- Tests 20-22: index, role scope, no auth.uid()
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
  NOT has_function_privilege('public', 'public.get_sales_daily_series(uuid, date, date)', 'EXECUTE'),
  'PUBLIC has no EXECUTE grant'
);

SELECT ok(
  (SELECT 'search_path=public, pg_temp' = ANY(proconfig)
     FROM pg_proc WHERE oid = 'public.get_sales_daily_series(uuid, date, date)'::regprocedure),
  'search_path is pinned to public, pg_temp'
);

SELECT * FROM finish();
ROLLBACK;
