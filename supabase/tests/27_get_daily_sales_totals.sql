-- Tests for get_daily_sales_totals function

BEGIN;
SELECT plan(10);

-- Disable RLS for test setup
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000100"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Fixture data: user + two restaurants

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000100'::uuid, 'daily-sales-test@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000101'::uuid, 'Daily Sales Test Restaurant', '456 Test St', '555-5678'),
  ('00000000-0000-0000-0000-000000000102'::uuid, 'Other Restaurant', '789 Other St', '555-9999')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000100'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000100'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Fixture sales for restaurant A (00..0101)
-- 3 regular sale items on 2024-03-01
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000110'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-001', 'Burger', 1, 12.50, '2024-03-01', 'sale'),
  ('00000000-0000-0000-0000-000000000111'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-002', 'Fries', 2, 8.00, '2024-03-01', 'sale'),
  ('00000000-0000-0000-0000-000000000112'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-003', 'Soda', 1, 3.50, '2024-03-01', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- 1 sale item on 2024-03-02
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000113'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-004', 'Salad', 1, 15.00, '2024-03-02', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- 1 sale item on 2024-03-03
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000114'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-005', 'Steak', 1, 28.00, '2024-03-03', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Adjustment items (should be excluded)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type, adjustment_type) VALUES
  ('00000000-0000-0000-0000-000000000115'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-001', 'Tip on Burger', 1, 2.50, '2024-03-01', 'sale', 'tip'),
  ('00000000-0000-0000-0000-000000000116'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-002', 'Tax on Fries', 1, 0.80, '2024-03-01', 'sale', 'tax')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Non-sale item_type (should be excluded)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000117'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-006', 'POS Tip', 1, 5.00, '2024-03-01', 'tip')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Parent sale with a child (split) -- parent should be excluded, child included
-- Parent sale on 2024-03-02
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000118'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-007', 'Combo Meal', 1, 20.00, '2024-03-02', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Child sale referencing parent
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type, parent_sale_id) VALUES
  ('00000000-0000-0000-0000-000000000119'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-007-split', 'Combo Meal Split', 1, 20.00, '2024-03-02', 'sale', '00000000-0000-0000-0000-000000000118'::uuid)
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Sales for restaurant B (should NOT appear when querying restaurant A)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000120'::uuid, '00000000-0000-0000-0000-000000000102'::uuid, 'square', 'ds-order-008', 'Pizza', 1, 18.00, '2024-03-01', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Boundary test items on 2024-03-10 and 2024-03-15
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type) VALUES
  ('00000000-0000-0000-0000-000000000121'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-009', 'Boundary Start', 1, 10.00, '2024-03-10', 'sale'),
  ('00000000-0000-0000-0000-000000000122'::uuid, '00000000-0000-0000-0000-000000000101'::uuid, 'square', 'ds-order-010', 'Boundary End', 1, 25.00, '2024-03-15', 'sale')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- ============================================================
-- Test 1: Function exists with correct signature (uuid, date, date)
-- ============================================================

SELECT has_function(
  'public', 'get_daily_sales_totals', ARRAY['uuid', 'date', 'date'],
  'get_daily_sales_totals function should exist with (uuid, date, date) signature'
);

-- ============================================================
-- Test 2: Function returns setof record
-- ============================================================

SELECT function_returns(
  'public', 'get_daily_sales_totals', ARRAY['uuid', 'date', 'date'], 'setof record',
  'get_daily_sales_totals should return setof record'
);

-- ============================================================
-- Test 3: Basic aggregation -- 3 sale items on same date
-- Expects SUM(12.50 + 8.00 + 3.50) = 24.00, COUNT = 3
-- (excludes adjustment items and non-sale item_type on same date)
-- ============================================================

SELECT is(
  (SELECT total_revenue FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-01'::DATE, '2024-03-01'::DATE
  ) WHERE sale_date = '2024-03-01'),
  24.00::DECIMAL,
  'Basic aggregation: SUM of 3 sale items on 2024-03-01 should be 24.00'
);

-- ============================================================
-- Test 4: Multiple dates -- query range returns 3 rows in order
-- 2024-03-01: 3 items (24.00)
-- 2024-03-02: 1 regular + 1 child (parent excluded) = 2 items (15.00 + 20.00 = 35.00)
-- 2024-03-03: 1 item (28.00)
-- ============================================================

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-01'::DATE, '2024-03-03'::DATE
  )),
  3::INTEGER,
  'Multiple dates: should return 3 rows for 3 distinct dates'
);

-- ============================================================
-- Test 5: Excludes adjustments -- items with adjustment_type are not counted
-- On 2024-03-01 there are tip (2.50) and tax (0.80) adjustments
-- They should be excluded from the total of 24.00
-- ============================================================

SELECT ok(
  (SELECT total_revenue FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-01'::DATE, '2024-03-01'::DATE
  ) WHERE sale_date = '2024-03-01') = 24.00,
  'Excludes adjustments: tip and tax adjustment items should not be included in revenue'
);

-- ============================================================
-- Test 6: Excludes non-sale item_type
-- On 2024-03-01 there is a 'tip' item_type (5.00) -- should be excluded
-- ============================================================

SELECT ok(
  (SELECT transaction_count FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-01'::DATE, '2024-03-01'::DATE
  ) WHERE sale_date = '2024-03-01') = 3,
  'Excludes non-sale items: transaction_count should be 3 (tip item_type excluded)'
);

-- ============================================================
-- Test 7: Excludes parent sales with splits
-- On 2024-03-02: regular Salad (15.00) + parent Combo (20.00, excluded) + child Split (20.00, included)
-- Expected: total_revenue = 35.00, transaction_count = 2
-- ============================================================

SELECT is(
  (SELECT total_revenue FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-02'::DATE, '2024-03-02'::DATE
  ) WHERE sale_date = '2024-03-02'),
  35.00::DECIMAL,
  'Excludes parent sales: parent with child split excluded, child included (15 + 20 = 35)'
);

-- ============================================================
-- Test 8: Empty date range -- no data in range
-- ============================================================

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-06-01'::DATE, '2024-06-30'::DATE
  )),
  0::INTEGER,
  'Empty date range: should return 0 rows when no sales exist in range'
);

-- ============================================================
-- Test 9: Restaurant isolation -- restaurant B data not in restaurant A query
-- Restaurant B has 18.00 on 2024-03-01, should not affect restaurant A totals
-- ============================================================

SELECT is(
  (SELECT total_revenue FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-01'::DATE, '2024-03-01'::DATE
  ) WHERE sale_date = '2024-03-01'),
  24.00::DECIMAL,
  'Restaurant isolation: restaurant B sales (18.00) should not appear in restaurant A query'
);

-- ============================================================
-- Test 10: Date range boundaries -- inclusive on both ends
-- Query from 2024-03-10 to 2024-03-15 should include both boundary dates
-- ============================================================

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM get_daily_sales_totals(
    '00000000-0000-0000-0000-000000000101'::uuid, '2024-03-10'::DATE, '2024-03-15'::DATE
  )),
  2::INTEGER,
  'Date boundaries: both p_date_from and p_date_to should be inclusive (2 rows)'
);

SELECT * FROM finish();
ROLLBACK;
