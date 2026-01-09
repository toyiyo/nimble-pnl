-- Comprehensive pgTAP tests for sync_toast_to_unified_sales function
-- Tests migration: 20260106120001_toast_sync_financial_breakdown.sql

BEGIN;
SELECT plan(23);

-- Setup: Disable RLS for test data creation
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;

-- Create test users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-200000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'authorized@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-200000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unauthorized@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-200000000011', 'Test Restaurant for Sync', '456 Test St', '555-4567')
ON CONFLICT (id) DO NOTHING;

-- Link authorized user to restaurant
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-200000000001', '00000000-0000-0000-0000-200000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Create test Toast data with various scenarios
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, discount_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-200000000021', 'toast-order-101', '00000000-0000-0000-0000-200000000011', 'toast-rest-guid-101', '2026-01-05', '12:30:00', 150.00, 12.00, 10.00, '{}'),
  ('00000000-0000-0000-0000-200000000022', 'toast-order-102', '00000000-0000-0000-0000-200000000011', 'toast-rest-guid-101', '2026-01-05', '13:00:00', 0.00, 0.00, 0.00, '{}'), -- Zero amounts
  ('00000000-0000-0000-0000-200000000023', 'toast-order-103', '00000000-0000-0000-0000-200000000011', 'toast-rest-guid-101', '2026-01-05', '14:00:00', 200.00, NULL, NULL, '{}') -- NULL amounts
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE 
  SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount, discount_amount = EXCLUDED.discount_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_id, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, menu_category, raw_json) VALUES
  ('toast-item-101', '00000000-0000-0000-0000-200000000021', 'toast-order-101', '00000000-0000-0000-0000-200000000011', 'Burger', 2, 75.00, 150.00, 'Entrees', '{}'),
  ('toast-item-102', '00000000-0000-0000-0000-200000000022', 'toast-order-102', '00000000-0000-0000-0000-200000000011', 'Zero Item', 0, 0.00, 0.00, 'Test', '{}'),
  ('toast-item-103', '00000000-0000-0000-0000-200000000023', 'toast-order-103', '00000000-0000-0000-0000-200000000011', 'Steak', 1, 200.00, 200.00, 'Entrees', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET total_price = EXCLUDED.total_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('toast-payment-101', 'toast-order-101', '00000000-0000-0000-0000-200000000011', '2026-01-05', 'CREDIT', 162.00, 15.00, 'PAID', '{"refundStatus": "NONE"}'),
  ('toast-payment-102', 'toast-order-101', '00000000-0000-0000-0000-200000000011', '2026-01-06', 'CREDIT', 50.00, 0, 'REFUNDED', '{"refundStatus": "FULL", "refund": {"refundAmount": 5000}}'),
  ('toast-payment-103', 'toast-order-102', '00000000-0000-0000-0000-200000000011', '2026-01-05', 'CASH', 0.00, 0.00, 'PAID', '{"refundStatus": "NONE"}'),
  ('toast-payment-104', 'toast-order-103', '00000000-0000-0000-0000-200000000011', '2026-01-05', 'CREDIT', 220.00, 20.00, 'PAID', '{"refundStatus": "PARTIAL", "refund": {"refundAmount": 3000}}')
ON CONFLICT (restaurant_id, toast_payment_guid) DO UPDATE 
  SET amount = EXCLUDED.amount, tip_amount = EXCLUDED.tip_amount, raw_json = EXCLUDED.raw_json;

-- ============================================================
-- TEST CATEGORY 1: Function Signature & Basic Checks
-- ============================================================

-- Test 1: Function exists with correct signature
SELECT has_function(
  'public',
  'sync_toast_to_unified_sales',
  ARRAY['uuid'],
  'sync_toast_to_unified_sales function should exist with UUID parameter'
);

-- Test 2: Function returns INTEGER
SELECT function_returns(
  'public',
  'sync_toast_to_unified_sales',
  ARRAY['uuid'],
  'integer',
  'sync_toast_to_unified_sales should return INTEGER'
);

-- ============================================================
-- TEST CATEGORY 2: Authorization Tests
-- ============================================================

-- Test 3: Authorized user can call function
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-200000000001"}';

SELECT lives_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-200000000011')$$,
  'Authorized user should be able to call sync function'
);

-- Test 4: Unauthorized user cannot call function
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-200000000002"}';

SELECT throws_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-200000000011')$$,
  'P0001',
  'Unauthorized: user does not have access to this restaurant',
  'Unauthorized user should be blocked from calling sync function'
);

-- ============================================================
-- TEST CATEGORY 3: Upsert Behavior - Preserve Categorization
-- ============================================================

SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-200000000001"}';

-- Test 5: Insert pre-existing unified_sales row with user categorization
-- First create a test category
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-200000000031'::uuid, '00000000-0000-0000-0000-200000000011'::uuid, '4000', 'Food Sales', 'revenue', 'credit', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales (
  restaurant_id,
  pos_system,
  external_order_id,
  external_item_id,
  item_name,
  quantity,
  unit_price,
  total_price,
  sale_date,
  sale_time,
  item_type,
  category_id,
  is_categorized,
  synced_at
) VALUES (
  '00000000-0000-0000-0000-200000000011',
  'toast',
  'toast-order-101',
  'toast-item-101',
  'Old Name',
  1,
  100.00,
  100.00,
  '2026-01-05',
  '10:00:00',
  'sale',
  '00000000-0000-0000-0000-200000000031'::uuid,
  true,
  NOW() - INTERVAL '2 hours'
) ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
  DO UPDATE SET category_id = COALESCE(unified_sales.category_id, EXCLUDED.category_id);

-- Run sync
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-200000000011');

-- Test 6: Verify row exists (not deleted)
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-101'
     AND item_type = 'sale') = 1,
  'Upsert should preserve existing row (not delete and recreate)'
);

-- Test 7: Verify POS-sourced fields updated
SELECT is(
  (SELECT item_name FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-101'),
  'Burger',
  'Upsert should update POS-sourced field: item_name'
);

SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-101'),
  150.00::numeric,
  'Upsert should update POS-sourced field: total_price'
);

-- Test 8: CRITICAL - Verify user-managed field preserved
SELECT is(
  (SELECT category_id::text FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-101'
     AND item_type = 'sale'),
  '00000000-0000-0000-0000-200000000031',
  'CRITICAL: Upsert should preserve user-managed field: category_id'
);

-- ============================================================
-- TEST CATEGORY 4: Financial Breakdown - Revenue
-- ============================================================

-- Test 9: Revenue entries created
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'sale'
     AND external_item_id IN ('toast-item-101', 'toast-item-103')) >= 2,
  'Function should create revenue entries for order items'
);

-- Test 10: Revenue entry has correct amount
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-103'),
  200.00::numeric,
  'Revenue entry should have correct total_price from order item'
);

-- ============================================================
-- TEST CATEGORY 5: Financial Breakdown - Discounts
-- ============================================================

-- Test 11: Discount entries created
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'discount'
     AND adjustment_type = 'discount'
     AND external_item_id = 'toast-order-101_discount') = 1,
  'Function should create discount entry for order with discount_amount'
);

-- Test 12: Discount amount is negative
SELECT ok(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-order-101_discount') < 0,
  'Discount entry should have negative amount'
);

-- ============================================================
-- TEST CATEGORY 6: Financial Breakdown - Tax
-- ============================================================

-- Test 13: Tax entries created
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'tax'
     AND adjustment_type = 'tax'
     AND external_item_id = 'toast-order-101_tax') = 1,
  'Function should create tax entry for order with tax_amount'
);

-- Test 14: Tax amount is correct
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-order-101_tax'),
  12.00::numeric,
  'Tax entry should have correct amount from order'
);

-- ============================================================
-- TEST CATEGORY 7: Financial Breakdown - Tips
-- ============================================================

-- Test 15: Tip entries created
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'tip'
     AND adjustment_type = 'tip'
     AND external_item_id LIKE '%_tip') >= 2,
  'Function should create tip entries for payments with tip_amount'
);

-- Test 16: Tip amount is correct
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-payment-101_tip'),
  15.00::numeric,
  'Tip entry should have correct amount from payment'
);

-- ============================================================
-- TEST CATEGORY 8: Financial Breakdown - Refunds
-- ============================================================

-- Test 17: Refund entries created for FULL refunds
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'refund'
     AND external_item_id = 'toast-payment-102_refund') = 1,
  'Function should create refund entry for payment with refundStatus=FULL'
);

-- Test 18: Refund amount is negative and correct
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-payment-102_refund'),
  -50.00::numeric,
  'Refund entry should have negative amount from refund.refundAmount (5000 cents = $50)'
);

-- Test 19: Refund entries created for PARTIAL refunds
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND item_type = 'refund'
     AND external_item_id = 'toast-payment-104_refund') = 1,
  'Function should create refund entry for payment with refundStatus=PARTIAL'
);

-- ============================================================
-- TEST CATEGORY 9: Edge Cases - NULL and Zero Amounts
-- ============================================================

-- Test 20: No discount entry for NULL discount_amount
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-order-103_discount'),
  0::bigint,
  'Function should NOT create discount entry when discount_amount is NULL'
);

-- Test 21: No tax entry for NULL tax_amount
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-order-103_tax'),
  0::bigint,
  'Function should NOT create tax entry when tax_amount is NULL'
);

-- Test 22: No entries for zero amounts
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-item-102'),
  0::bigint,
  'Function should NOT create revenue entry for zero total_price'
);

-- Test 23: No refund entry for refundStatus=NONE
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-200000000011'
     AND external_item_id = 'toast-payment-101_refund'),
  0::bigint,
  'Function should NOT create refund entry for payment with refundStatus=NONE'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
