-- Tests for sync_toast_to_unified_sales authorization
-- Tests for migration 20260106120001_toast_sync_financial_breakdown.sql

BEGIN;
SELECT plan(12);

-- Setup: Disable RLS for test data creation
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Create test users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-100000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-100000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unauthorized@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-100000000011', 'Test Toast Restaurant', '123 Main St', '555-1234')
ON CONFLICT (id) DO NOTHING;

-- Link owner user to restaurant
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-100000000001', '00000000-0000-0000-0000-100000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Create test Toast data
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, discount_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-100000000021', 'toast-order-001', '00000000-0000-0000-0000-100000000011', 'toast-rest-guid-001', '2026-01-01', '12:00:00', 100.00, 8.00, 5.00, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = 100.00;

INSERT INTO toast_order_items (toast_item_guid, toast_order_id, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, menu_category, raw_json) VALUES
  ('toast-item-001', '00000000-0000-0000-0000-100000000021', 'toast-order-001', '00000000-0000-0000-0000-100000000011', 'Test Item', 1, 100.00, 100.00, 'Food', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET total_price = 100.00;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('toast-payment-001', 'toast-order-001', '00000000-0000-0000-0000-100000000011', '2026-01-01', 'CREDIT', 103.00, 10.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid) DO UPDATE SET amount = 103.00, raw_json = '{"refundStatus": "NONE"}';

-- Add refunded payment for testing refund detection
INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('toast-payment-002-refund', 'toast-order-001', '00000000-0000-0000-0000-100000000011', '2026-01-02', 'CREDIT', 50.00, 0, 'REFUNDED', '{"refundStatus": "FULL", "refund": {"refundAmount": 5000}}')
ON CONFLICT (restaurant_id, toast_payment_guid) DO UPDATE SET amount = 50.00, raw_json = '{"refundStatus": "FULL", "refund": {"refundAmount": 5000}}';

-- ============================================================
-- TEST CATEGORY 1: Function Signature
-- ============================================================

-- Test 1: Function exists with correct signature
SELECT has_function(
  'public',
  'sync_toast_to_unified_sales',
  ARRAY['uuid'],
  'sync_toast_to_unified_sales function should exist'
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
-- TEST CATEGORY 2: Authorization Checks
-- ============================================================

-- Test 3: Authorized user can call function
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-100000000001"}';

SELECT lives_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-100000000011')$$,
  'Authorized owner should be able to call sync function'
);

-- Test 4: Function returns expected count (at least revenue + discount + tax + tip)
SELECT ok(
  (SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-100000000011')) >= 4,
  'Function should return count of at least 4 synced rows (revenue, discount, tax, tip)'
);

-- Test 5: Unauthorized user cannot call function
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-100000000002"}';

SELECT throws_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-100000000011')$$,
  'P0001', -- RAISE EXCEPTION error code
  'Unauthorized: user does not have access to this restaurant',
  'Unauthorized user should be blocked from calling sync function'
);

-- ============================================================
-- TEST CATEGORY 3: Data Integrity & Upsert Behavior
-- ============================================================

-- Test 6: Function preserves user-managed fields during upsert
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-100000000001"}';

-- Insert a pre-existing unified_sales row with custom_category (user-managed field)
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
  custom_category,
  synced_at
) VALUES (
  '00000000-0000-0000-0000-100000000011',
  'toast',
  'toast-order-001',
  'toast-item-001',
  'Old Item Name',
  1,
  90.00,
  90.00,
  '2026-01-01',
  '11:00:00',
  'sale',
  'User Custom Category',
  NOW() - INTERVAL '1 hour'
) ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id) 
  WHERE parent_sale_id IS NULL 
  DO UPDATE SET custom_category = 'User Custom Category';

-- Run sync which should update POS fields but preserve custom_category
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-100000000011');

-- Assert that the row was updated (not deleted/recreated)
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND external_item_id = 'toast-item-001'
     AND item_type = 'sale') = 1,
  'Function should update existing revenue entry, not create duplicate'
);

-- Assert POS-sourced fields were updated
SELECT is(
  (SELECT item_name FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND external_item_id = 'toast-item-001'),
  'Test Item',
  'Function should update item_name from POS data'
);

SELECT is(
  (SELECT total_price FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND external_item_id = 'toast-item-001'),
  100.00::numeric,
  'Function should update total_price from POS data'
);

-- Assert user-managed field was preserved
SELECT is(
  (SELECT custom_category FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND external_item_id = 'toast-item-001'),
  'User Custom Category',
  'CRITICAL: Function should preserve user-managed custom_category field during upsert'
);

-- Test 7: Function correctly syncs all entry types (sale, discount, tax, tip)
SELECT is(
  (SELECT COUNT(DISTINCT item_type) FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011'
     AND item_type IN ('sale', 'discount', 'tax', 'tip')),
  4::bigint,
  'Function should create entries for all 4 item_types: sale, discount, tax, tip'
);

-- ============================================================
-- TEST CATEGORY 4: Refund Detection
-- ============================================================

-- Test 8: Alias function exists
SELECT has_function(
  'public',
  'toast_sync_financial_breakdown',
  ARRAY['text', 'uuid'],
  'toast_sync_financial_breakdown alias function should exist'
);

-- Test 9: Alias function works
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-100000000001"}';
SELECT lives_ok(
  $$SELECT toast_sync_financial_breakdown('toast-order-001', '00000000-0000-0000-0000-100000000011')$$,
  'Alias function toast_sync_financial_breakdown should work'
);

-- Test 10: Refund entries are created for payments with refundStatus FULL
SELECT ok(
  (SELECT COUNT(*) FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND item_type = 'refund' 
     AND external_item_id = 'toast-payment-002-refund_refund') = 1,
  'Function should create refund entry for payment with refundStatus=FULL'
);

-- Test 11: Refund amount is correctly extracted from raw_json and negated
SELECT is(
  (SELECT total_price FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND item_type = 'refund' 
     AND external_item_id = 'toast-payment-002-refund_refund'),
  -50.00::numeric,
  'Refund entry should have negative amount from refund.refundAmount (5000 cents = $50.00)'
);

-- Test 12: No refund entry for payment without refund
SELECT is(
  (SELECT COUNT(*) FROM unified_sales 
   WHERE restaurant_id = '00000000-0000-0000-0000-100000000011' 
     AND item_type = 'refund' 
     AND external_item_id = 'toast-payment-001_refund'),
  0::bigint,
  'Function should NOT create refund entry for payment with refundStatus=NONE'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
