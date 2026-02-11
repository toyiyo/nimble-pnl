-- pgTAP tests for Toast comps/discounts/voids support
-- Tests migration: 20260211300000_toast_comps_discounts_voids.sql
--
-- Verifies the "Gross + Offset Entries" approach:
--   - Revenue at gross price (unit_price)
--   - Negative discount entries for comps/discounts
--   - Negative void entries for voided items
--   - Correct net amounts match Toast's Net Amount report

BEGIN;
SELECT plan(17);

-- Setup: Disable RLS for test data creation
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Create test user
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-280000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'toast-comps-test@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-280000000011', 'Toast Comps Test Restaurant', '789 Test St', '555-7890')
ON CONFLICT (id) DO NOTHING;

-- Link user to restaurant
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-280000000001', '00000000-0000-0000-0000-280000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Create test orders
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, discount_amount, raw_json) VALUES
  -- Order with normal + discounted + comped items
  ('00000000-0000-0000-0000-280000000021', 'comps-order-1', '00000000-0000-0000-0000-280000000011', 'toast-rest-comps', '2026-02-10', '12:00:00', 100.00, 8.50, NULL, '{}'),
  -- Order with voided item
  ('00000000-0000-0000-0000-280000000022', 'comps-order-2', '00000000-0000-0000-0000-280000000011', 'toast-rest-comps', '2026-02-10', '13:00:00', 50.00, 4.00, NULL, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE
  SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount;

-- Create test order items covering all scenarios:
-- 1. Normal item (no discount)
-- 2. 10% discounted item
-- 3. Fully comped item (100% discount)
-- 4. Voided item
-- 5. Zero price item (should be excluded)
INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json) VALUES
  -- Normal: $27.95, no discount
  ('comps-item-normal', 'comps-order-1', '00000000-0000-0000-0000-280000000011', 'Truffle Pasta', 1, 27.95, 27.95, false, 0, 'Entrees', '{"voided": false}'),
  -- 10% discount: $28.95 gross, $26.05 net, $2.90 discount
  ('comps-item-discount', 'comps-order-1', '00000000-0000-0000-0000-280000000011', 'Chicken Piccata', 1, 28.95, 26.05, false, 2.90, 'Entrees', '{"voided": false}'),
  -- Fully comped: $27.95 gross, $0.00 net, $27.95 discount
  ('comps-item-comped', 'comps-order-1', '00000000-0000-0000-0000-280000000011', 'Chicken Carbonara', 1, 23.95, 0.00, false, 23.95, 'Entrees', '{"voided": false}'),
  -- Voided: $22.95 gross, not voided=true
  ('comps-item-voided', 'comps-order-2', '00000000-0000-0000-0000-280000000011', 'Grilled Salmon Salad', 1, 22.95, 22.95, true, 0, 'Entrees', '{"voided": true}'),
  -- Zero price add-on (should not create revenue entry)
  ('comps-item-zero', 'comps-order-1', '00000000-0000-0000-0000-280000000011', 'Extra Sauce', 1, 0.00, 0.00, false, 0, 'Add-ons', '{"voided": false}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price, total_price = EXCLUDED.total_price,
      is_voided = EXCLUDED.is_voided, discount_amount = EXCLUDED.discount_amount;

-- Create test payment with tip
INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('comps-payment-1', 'comps-order-1', '00000000-0000-0000-0000-280000000011', '2026-02-10', 'CREDIT', 100.00, 15.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid) DO UPDATE
  SET amount = EXCLUDED.amount, tip_amount = EXCLUDED.tip_amount;

-- Run the sync function
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-280000000001"}';
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-280000000011');


-- ============================================================
-- TEST 1: Schema changes exist
-- ============================================================

SELECT has_column(
  'toast_order_items', 'is_voided',
  'toast_order_items should have is_voided column'
);

SELECT has_column(
  'toast_order_items', 'discount_amount',
  'toast_order_items should have discount_amount column'
);


-- ============================================================
-- TEST 2: Normal item — revenue at gross price, no offset
-- ============================================================

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-normal'
     AND item_type = 'sale'),
  27.95::numeric,
  'Normal item: revenue entry at gross price ($27.95)'
);

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-normal_discount'),
  0::bigint,
  'Normal item: no discount offset entry'
);


-- ============================================================
-- TEST 3: 10% discounted item — revenue + discount offset
-- ============================================================

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-discount'
     AND item_type = 'sale'),
  28.95::numeric,
  'Discounted item: revenue at gross price ($28.95)'
);

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-discount_discount'
     AND item_type = 'discount'),
  -2.90::numeric,
  'Discounted item: discount offset is -$2.90'
);

-- Verify net = revenue + offset = $26.05
SELECT is(
  (SELECT SUM(total_price) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id IN ('comps-item-discount', 'comps-item-discount_discount')),
  26.05::numeric,
  'Discounted item: net amount matches Toast ($26.05)'
);


-- ============================================================
-- TEST 4: Fully comped item — revenue + full offset = $0
-- ============================================================

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-comped'
     AND item_type = 'sale'),
  23.95::numeric,
  'Comped item: revenue at gross price ($23.95)'
);

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-comped_discount'
     AND item_type = 'discount'),
  -23.95::numeric,
  'Comped item: discount offset is -$23.95 (full comp)'
);

-- Verify net = $0
SELECT is(
  (SELECT SUM(total_price) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id IN ('comps-item-comped', 'comps-item-comped_discount')),
  0.00::numeric,
  'Comped item: net amount is $0.00'
);


-- ============================================================
-- TEST 5: Voided item — no revenue, has void offset
-- ============================================================

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-voided'
     AND item_type = 'sale'),
  0::bigint,
  'Voided item: no revenue entry (filtered out)'
);

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-voided_void'
     AND adjustment_type = 'void'),
  -22.95::numeric,
  'Voided item: void offset is -$22.95'
);


-- ============================================================
-- TEST 6: Zero price item — excluded entirely
-- ============================================================

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-item-zero'),
  0::bigint,
  'Zero price item: no revenue entry'
);


-- ============================================================
-- TEST 7: Tax and tips still work
-- ============================================================

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-order-1_tax'),
  8.50::numeric,
  'Tax entry created correctly ($8.50)'
);

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_item_id = 'comps-payment-1_tip'),
  15.00::numeric,
  'Tip entry created correctly ($15.00)'
);


-- ============================================================
-- TEST 8: Order-level discount section removed
-- ============================================================

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND item_name = 'Order Discount'),
  0::bigint,
  'No order-level discount entries (section removed)'
);


-- ============================================================
-- TEST 9: Total net revenue matches expected
-- ============================================================

-- Sum of all sale + discount entries for order 1:
-- Normal: $27.95 + $0 = $27.95
-- Discounted: $28.95 + (-$2.90) = $26.05
-- Comped: $23.95 + (-$23.95) = $0.00
-- Total: $54.00 (27.95 + 26.05 + 0.00)
SELECT is(
  (SELECT SUM(total_price) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-280000000011'
     AND external_order_id = 'comps-order-1'
     AND item_type IN ('sale', 'discount')),
  54.00::numeric,
  'Order 1 net revenue: $54.00 (normal $27.95 + discounted net $26.05 + comped net $0)'
);


-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
