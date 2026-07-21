-- pgTAP tests for get_sales_trends(p_restaurant_id, p_start_date, p_end_date, p_time_zone)
-- Design: docs/superpowers/specs/2026-07-20-pos-sales-trends-design.md §4.1
--
-- Fixture restaurant 00000000-0000-0000-0000-000000000099, tz America/Chicago
-- (CDT = UTC-5 for the Aug-2024 fixture dates, so hour math below is exact).
--
-- Revenue predicate under test: parent_sale_id IS NULL AND adjustment_type IS NULL
-- AND item_type = 'sale'. Fixture rows R9-R13 (tip/tax/void/discount/child-split)
-- must never contribute to any bucket.
--
-- NOTE on the plan's "manual row with NULL external_order_id still counted in
-- orders" case: unified_sales.external_order_id is `TEXT NOT NULL` (base migration
-- 20250925125415, never relaxed — confirmed against the live schema), so that
-- fixture is not constructible; a NULL there would fail at INSERT, not exercise
-- the RPC. The `orders` COALESCE(external_order_id, id::text) is still implemented
-- defensively in the RPC (schema forward-compatibility), but is pinned here instead
-- via the behavior it actually protects: COUNT(DISTINCT external_order_id) collapsing
-- a multi-line-item order (R1+R2 share external_order_id 't-1') into a single order.
BEGIN;
SELECT plan(23);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'trends-member@example.com'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'trends-nonmember@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone, timezone) VALUES
  ('00000000-0000-0000-0000-000000000099'::uuid, 'Trends Test Restaurant', '1 Trend Ave', '555-0099', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET name = 'Trends Test Restaurant', timezone = 'America/Chicago';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ============================================================
-- Fixture rows (all restaurant 0099)
-- ============================================================
-- R1/R2 share external_order_id 't-1' (multi-item order) — both bucket to
-- hour 14 (2024-08-01T19:30/19:35 UTC -> 14:30/14:35 CDT).
-- R3 is a second toast order 't-2' on the same day, hour 18.
-- R4 is a square order on the same day, hour 15.
-- R5 is toast on 2024-08-02 (Friday), also hour 14 (cross-day hour aggregation).
-- R6 has sold_at NULL, sale_time '10:15:00' -> hour 10 via the sale_time fallback.
-- R7 has both sold_at and sale_time NULL -> dropped from by_hour only.
-- R8 is the day-boundary tz case: sale_date is explicitly 2024-08-03, but its
-- sold_at converts to local 2024-08-02 18:00 (hour 18) — by_day/by_weekday use
-- sale_date (08-03) while by_hour uses the sold_at-derived hour (18), independently.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price,
  sale_date, sale_time, sold_at, item_type, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-0000000000f1'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Burger',2,20.00,'2024-08-01',NULL,'2024-08-01T19:30:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f2'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Fries',1,5.00,'2024-08-01',NULL,'2024-08-01T19:35:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f3'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-2','Burger',1,10.00,'2024-08-01',NULL,'2024-08-01T23:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f4'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'square','sq-1','Burger',1,8.00,'2024-08-01',NULL,'2024-08-01T20:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f5'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-3','Burger',1,15.00,'2024-08-02',NULL,'2024-08-02T19:00:00+00'::timestamptz,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f6'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-4','Soda',1,3.00,'2024-08-02','10:15:00'::time,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f7'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-5','Water',1,2.00,'2024-08-02',NULL,NULL,'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000f8'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-6','Steak',1,40.00,'2024-08-03',NULL,'2024-08-02T23:00:00+00'::timestamptz,'sale',NULL,NULL),
  -- Excluded rows: tip, tax, void, discount, child-split
  ('00000000-0000-0000-0000-0000000000f9'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Tip',1,5.00,'2024-08-01',NULL,NULL,'tip','tip',NULL),
  ('00000000-0000-0000-0000-0000000000fa'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Tax',1,3.00,'2024-08-01',NULL,NULL,'tax','tax',NULL),
  ('00000000-0000-0000-0000-0000000000fb'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Void - Burger',1,-10.00,'2024-08-01',NULL,NULL,'discount','void',NULL),
  ('00000000-0000-0000-0000-0000000000fc'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Discount - Burger',1,-2.00,'2024-08-01',NULL,NULL,'discount','discount',NULL),
  ('00000000-0000-0000-0000-0000000000fd'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','t-1','Burger',1,999.00,'2024-08-01',NULL,NULL,'sale',NULL,'00000000-0000-0000-0000-0000000000f1'::uuid)
ON CONFLICT (id) DO UPDATE SET
  external_order_id = EXCLUDED.external_order_id, item_name = EXCLUDED.item_name,
  quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, sale_date = EXCLUDED.sale_date,
  sale_time = EXCLUDED.sale_time, sold_at = EXCLUDED.sold_at, item_type = EXCLUDED.item_type,
  adjustment_type = EXCLUDED.adjustment_type, parent_sale_id = EXCLUDED.parent_sale_id;

-- Clamp fixtures, dated relative to CURRENT_DATE so the 90-day default window
-- (only exercised when BOTH p_start_date and p_end_date are NULL) is deterministic
-- regardless of when this test runs.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price,
  sale_date, item_type, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-0000000000fe'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','old-1','OldItem',1,77.00,(CURRENT_DATE - 200),'sale',NULL,NULL),
  ('00000000-0000-0000-0000-0000000000ff'::uuid,'00000000-0000-0000-0000-000000000099'::uuid,'toast','recent-1','RecentItem',1,66.00,(CURRENT_DATE - 5),'sale',NULL,NULL)
ON CONFLICT (id) DO UPDATE SET
  external_order_id = EXCLUDED.external_order_id, item_name = EXCLUDED.item_name,
  quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, sale_date = EXCLUDED.sale_date;

-- ============================================================
-- Test 1: non-member call raises Access denied
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000002"}';
SELECT throws_ok(
  $$ SELECT get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-01') $$,
  'Access denied to restaurant',
  'non-member call raises Access denied'
);
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

-- ============================================================
-- Tests 2-18: main 2024-08-01..2024-08-03 range
-- ============================================================

-- Test 2: total revenue for 2024-08-01 across POS = 43.00 (excludes tip/tax/void/discount/child-split)
SELECT is(
  (SELECT COALESCE(SUM((e->>'revenue')::numeric), 0)
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-01'),
  43.00::numeric,
  '2024-08-01 total revenue excludes tip/tax/void/discount/child-split rows'
);

-- Test 3: toast revenue for 2024-08-01 = 35.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-01' AND e->>'pos_system' = 'toast'),
  35.00::numeric,
  'toast revenue for 2024-08-01 groups separately from square'
);

-- Test 4: square revenue for 2024-08-01 = 8.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-01' AND e->>'pos_system' = 'square'),
  8.00::numeric,
  'square revenue for 2024-08-01 groups separately from toast'
);

-- Test 5: orders for toast 2024-08-01 = 2 (t-1 multi-item + t-2, distinct external_order_id)
SELECT is(
  (SELECT (e->>'orders')::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-01' AND e->>'pos_system' = 'toast'),
  2,
  'toast orders on 2024-08-01 counts distinct external_order_id (t-1 multi-item order collapses to 1)'
);

-- Test 6: orders for square 2024-08-01 = 1
SELECT is(
  (SELECT (e->>'orders')::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-01' AND e->>'pos_system' = 'square'),
  1,
  'square orders on 2024-08-01 = 1'
);

-- Test 7: pos_systems is present, revenue-desc (toast 95.00 > square 8.00)
SELECT is(
  (SELECT get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'pos_systems'),
  '["toast", "square"]'::jsonb,
  'pos_systems lists distinct systems, revenue desc'
);

-- Test 8: hour 14 toast revenue (R1+R2+R5, aggregated across 08-01 and 08-02) = 40.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE (e->>'hour')::int = 14 AND e->>'pos_system' = 'toast'),
  40.00::numeric,
  'hour 14 toast revenue aggregates sold_at-derived hour across days'
);

-- Test 9: hour 14 toast day_count = 2 distinct sale_date (08-01, 08-02)
SELECT is(
  (SELECT (e->>'day_count')::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE (e->>'hour')::int = 14 AND e->>'pos_system' = 'toast'),
  2,
  'hour 14 toast day_count = distinct sale_date count'
);

-- Test 10: hour 18 toast revenue (R3 + R8, cross day-boundary sold_at) = 50.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE (e->>'hour')::int = 18 AND e->>'pos_system' = 'toast'),
  50.00::numeric,
  'hour 18 toast revenue combines R3 (sale_date 08-01) and R8 (sale_date 08-03, sold_at-local 08-02 18:00)'
);

-- Test 11: hour 15 square revenue = 8.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE (e->>'hour')::int = 15 AND e->>'pos_system' = 'square'),
  8.00::numeric,
  'hour 15 square revenue'
);

-- Test 12: hour 10 toast revenue = 3.00, via EXTRACT(HOUR FROM sale_time) fallback (R6, sold_at IS NULL)
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE (e->>'hour')::int = 10 AND e->>'pos_system' = 'toast'),
  3.00::numeric,
  'sale_time-only row (sold_at IS NULL) buckets via EXTRACT(HOUR FROM sale_time)'
);

-- Test 13: by_hour total toast revenue = 93.00 (excludes R7's 2.00, the both-NULL-time row)
SELECT is(
  (SELECT COALESCE(SUM((e->>'revenue')::numeric), 0)
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_hour'
   ) e
   WHERE e->>'pos_system' = 'toast'),
  93.00::numeric,
  'by_hour total excludes the both-NULL-time row (R7, Water) that by_day/by_product still include'
);

-- Test 14: by_day 2024-08-02 toast revenue = 20.00 (R5+R6+R7, R7 present here despite absent from by_hour)
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-02' AND e->>'pos_system' = 'toast'),
  20.00::numeric,
  'by_day 2024-08-02 includes the both-NULL-time row (R7) that by_hour drops'
);

-- Test 15: by_day 2024-08-03 toast revenue = 40.00 — buckets on sale_date, independent of
-- sold_at's local calendar date (which is 08-02 for this row; see Test 10).
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_day'
   ) e
   WHERE e->>'sale_date' = '2024-08-03' AND e->>'pos_system' = 'toast'),
  40.00::numeric,
  'by_day day-boundary case buckets on sale_date, not sold_at-derived local date'
);

-- Test 16: by_weekday dow=4 (Thursday, 2024-08-01) toast revenue = 35.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_weekday'
   ) e
   WHERE (e->>'dow')::int = 4 AND e->>'pos_system' = 'toast'),
  35.00::numeric,
  'by_weekday dow via EXTRACT(DOW FROM sale_date) — Thursday'
);

-- Test 17: by_weekday dow=6 (Saturday, 2024-08-03) toast revenue = 40.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_weekday'
   ) e
   WHERE (e->>'dow')::int = 6 AND e->>'pos_system' = 'toast'),
  40.00::numeric,
  'by_weekday dow via EXTRACT(DOW FROM sale_date) — Saturday'
);

-- Test 18: by_product Burger/toast revenue = 45.00 (R1 20 + R3 10 + R5 15), quantity = 4 (2+1+1)
SELECT is(
  (SELECT jsonb_build_object('revenue', e->>'revenue', 'quantity', e->>'quantity')
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-08-01','2024-08-03')->'by_product'
   ) e
   WHERE e->>'item_name' = 'Burger' AND e->>'pos_system' = 'toast'),
  jsonb_build_object('revenue', '45.00', 'quantity', '4'),
  'by_product merges revenue and sums quantity per (item_name, pos_system)'
);

-- ============================================================
-- Test 19: empty range -> every array is []
-- ============================================================
SELECT is(
  get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid,'2024-09-01','2024-09-01'),
  jsonb_build_object(
    'pos_systems', '[]'::jsonb,
    'by_day', '[]'::jsonb,
    'by_hour', '[]'::jsonb,
    'by_weekday', '[]'::jsonb,
    'by_product', '[]'::jsonb
  ),
  'empty range returns [] for every bucket, never null'
);

-- ============================================================
-- Tests 20-21: NULL-both-dates -> 90-day clamp (CURRENT_DATE-relative fixtures)
-- ============================================================

-- Test 20: only 1 by_day row for restaurant 0099 when both dates are NULL
-- (the 200-day-old row falls outside the CURRENT_DATE-90..CURRENT_DATE clamp)
SELECT is(
  (SELECT COUNT(*)::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid, NULL, NULL)->'by_day'
   ) e
   WHERE e->>'pos_system' = 'toast'
     AND (e->>'sale_date')::date IN ((CURRENT_DATE - 200), (CURRENT_DATE - 5))),
  1,
  'NULL-both-dates clamps to the last 90 days: only the 5-day-old row qualifies'
);

-- Test 21: the qualifying row is the 5-day-old one, revenue 66.00
SELECT is(
  (SELECT (e->>'revenue')::numeric
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid, NULL, NULL)->'by_day'
   ) e
   WHERE e->>'sale_date' = (CURRENT_DATE - 5)::text AND e->>'pos_system' = 'toast'),
  66.00::numeric,
  'the in-window (5-day-old) row is present with its full revenue'
);

-- ============================================================
-- Tests 22-23: partial-NULL date pairs still clamp the open side
-- (regression: previously only the both-NULL case was clamped, leaving
-- a single NULL endpoint unbounded and able to scan full history)
-- ============================================================

-- Test 22: p_start_date NULL, p_end_date supplied -> start clamps to
-- CURRENT_DATE-90, so the 200-day-old row is still excluded
SELECT is(
  (SELECT COUNT(*)::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid, NULL, CURRENT_DATE)->'by_day'
   ) e
   WHERE e->>'pos_system' = 'toast'
     AND (e->>'sale_date')::date IN ((CURRENT_DATE - 200), (CURRENT_DATE - 5))),
  1,
  'NULL start_date with supplied end_date still clamps to a 90-day start'
);

-- Test 23: p_end_date NULL, p_start_date supplied before both fixtures ->
-- end clamps to CURRENT_DATE, so both the 200-day-old and 5-day-old rows qualify
SELECT is(
  (SELECT COUNT(*)::int
   FROM jsonb_array_elements(
     get_sales_trends('00000000-0000-0000-0000-000000000099'::uuid, (CURRENT_DATE - 200), NULL)->'by_day'
   ) e
   WHERE e->>'pos_system' = 'toast'
     AND (e->>'sale_date')::date IN ((CURRENT_DATE - 200), (CURRENT_DATE - 5))),
  2,
  'NULL end_date with supplied start_date still clamps to CURRENT_DATE, including both rows'
);

SELECT * FROM finish();
ROLLBACK;
