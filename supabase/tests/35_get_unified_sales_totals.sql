-- Tests for get_unified_sales_totals: adjustment rows must not count as revenue
BEGIN;
SELECT plan(8);

-- Setup: disable RLS and set auth context
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Fixture: user, restaurant, user_restaurants
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'totals-test@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000099'::uuid, 'Totals Test Restaurant', '456 Oak Ave', '555-9999')
ON CONFLICT (id) DO UPDATE SET name = 'Totals Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Fixture: unified_sales rows mimicking manual POS entry
-- Sale row: $50 food sale (item_type defaults to 'sale', no adjustment_type)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date)
VALUES ('00000000-0000-0000-0000-000000000100'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Burger', 1, 50.00, '2024-06-15')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = NULL;

-- Tip row: $10 tip — has adjustment_type='tip' but item_type defaults to 'sale' (the bug)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000101'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Tip', 1, 10.00, '2024-06-15', 'tip')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = EXCLUDED.adjustment_type;

-- Tax row: $4 tax — has adjustment_type='tax' but item_type defaults to 'sale'
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000102'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Sales Tax', 1, 4.00, '2024-06-15', 'tax')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = EXCLUDED.adjustment_type;

-- Service charge row: $3 — has adjustment_type='service_charge', item_type defaults to 'sale'
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000103'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Service Charge', 1, 3.00, '2024-06-15', 'service_charge')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = EXCLUDED.adjustment_type;

-- Discount row: -$5 discount — has adjustment_type='discount', item_type defaults to 'sale'
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000104'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Discount', 1, -5.00, '2024-06-15', 'discount')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = EXCLUDED.adjustment_type;

-- Fee row: $2 — has adjustment_type='fee', item_type defaults to 'sale'
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000105'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'manual', 'ord-totals-1', 'Platform Fee', 1, 2.00, '2024-06-15', 'fee')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, adjustment_type = EXCLUDED.adjustment_type;

-- Also add a properly-typed tip row (item_type='tip') to verify it still works
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000106'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'toast', 'ord-totals-2', 'Toast Tip', 1, 8.00, '2024-06-15', 'tip', 'tip')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price, item_type = EXCLUDED.item_type, adjustment_type = EXCLUDED.adjustment_type;

-- Test 1: Function exists
SELECT has_function(
  'public', 'get_unified_sales_totals', ARRAY['uuid', 'date', 'date', 'text'],
  'get_unified_sales_totals function should exist'
);

-- Test 2: Revenue = only the $50 sale (not tips/tax/fees/service charges)
SELECT is(
  (SELECT revenue FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-15'::DATE, '2024-06-15'::DATE
  )),
  50.00::NUMERIC,
  'Revenue should be $50 (sale only, no adjustment rows)'
);

-- Test 3: Pass-through = tip ($10) + tax ($4) + service_charge ($3) + fee ($2) + toast_tip ($8) = $27
SELECT is(
  (SELECT pass_through_amount FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-15'::DATE, '2024-06-15'::DATE
  )),
  27.00::NUMERIC,
  'Pass-through should be $27 (tip + tax + service_charge + fee + toast_tip)'
);

-- Test 4: Discounts = $5 (absolute value)
SELECT is(
  (SELECT discounts FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-15'::DATE, '2024-06-15'::DATE
  )),
  5.00::NUMERIC,
  'Discounts should be $5 (absolute value of discount adjustment)'
);

-- Test 5: Voids = $0 (no void adjustments in test data)
SELECT is(
  (SELECT voids FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-15'::DATE, '2024-06-15'::DATE
  )),
  0.00::NUMERIC,
  'Voids should be $0 (no void adjustments)'
);

-- Test 6: Collected at POS = sum of ALL rows = 50 + 10 + 4 + 3 + (-5) + 2 + 8 = $72
SELECT is(
  (SELECT collected_at_pos FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-15'::DATE, '2024-06-15'::DATE
  )),
  72.00::NUMERIC,
  'Collected at POS should be $72 (sum of all rows)'
);

-- Test 7: Legacy item_type='discount' rows still work correctly
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type)
VALUES ('00000000-0000-0000-0000-000000000107'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'square', 'ord-totals-3', 'Legacy Discount', 1, -7.00, '2024-06-16', 'discount');

SELECT is(
  (SELECT discounts FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-16'::DATE, '2024-06-16'::DATE
  )),
  7.00::NUMERIC,
  'Legacy discount (item_type=discount, no adjustment_type) should count as discount'
);

-- Test 8: Void via adjustment_type counts as void
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, item_type, adjustment_type)
VALUES ('00000000-0000-0000-0000-000000000108'::uuid, '00000000-0000-0000-0000-000000000099'::uuid, 'square', 'ord-totals-4', 'Voided Item', 1, -15.00, '2024-06-17', 'discount', 'void');

SELECT is(
  (SELECT voids FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000099'::uuid, '2024-06-17'::DATE, '2024-06-17'::DATE
  )),
  15.00::NUMERIC,
  'Void via adjustment_type should count as void'
);

SELECT * FROM finish();
ROLLBACK;
