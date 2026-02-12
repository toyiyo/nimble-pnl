-- pgTAP tests for stale Toast unified_sales cleanup
-- Tests migration: 20260211600000_fix_toast_stale_unified_sales.sql
--
-- Verifies DELETE steps that remove stale unified_sales entries
-- when toast_order_items become voided, tax drops to $0, discounts
-- on voided items, and denied/voided payment tips.
-- Also covers authorization, upsert semantics, date-range overload,
-- and correct sign/negative handling.

BEGIN;
SELECT plan(40);

-- ============================================================
-- Setup: Disable RLS for test data creation
-- ============================================================
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Create test users (authorized owner + unauthorized outsider)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-290000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stale-owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-290000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'stale-unauthorized@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-290000000011', 'Stale Cleanup Test Restaurant', '999 Test Ave', '555-9999')
ON CONFLICT (id) DO NOTHING;

-- Link owner to restaurant (unauthorized user has NO link)
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-290000000001', '00000000-0000-0000-0000-290000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- ============================================================
-- Fixture: Toast orders covering stale-entry scenarios
-- ============================================================

-- Order 1: Normal order (Feb 8) - will have items that become voided AFTER initial sync
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-290000000021', 'stale-order-1', '00000000-0000-0000-0000-290000000011', 'stale-rest-guid', '2026-02-08', '12:00:00', 80.00, 6.40, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount;

-- Order 2: Order whose tax will drop to $0 (Feb 9) - e.g. fully comp'd
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-290000000022', 'stale-order-2', '00000000-0000-0000-0000-290000000011', 'stale-rest-guid', '2026-02-09', '13:00:00', 50.00, 4.00, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount;

-- Order 3: Order outside date range (Jan 15) - for date-range filtering tests
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-290000000023', 'stale-order-3', '00000000-0000-0000-0000-290000000011', 'stale-rest-guid', '2026-01-15', '14:00:00', 30.00, 2.40, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount;

-- ============================================================
-- Fixture: Order items - initially NOT voided
-- ============================================================
INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json) VALUES
  -- Order 1: Two items, both initially active
  ('stale-item-a', 'stale-order-1', '00000000-0000-0000-0000-290000000011', 'Margherita Pizza', 1, 18.95, 18.95, false, 0, 'Entrees', '{}'),
  ('stale-item-b', 'stale-order-1', '00000000-0000-0000-0000-290000000011', 'Caesar Salad', 1, 12.95, 12.95, false, 3.00, 'Salads', '{}'),
  -- Order 2: Item with discount (will be voided later)
  ('stale-item-c', 'stale-order-2', '00000000-0000-0000-0000-290000000011', 'Grilled Salmon', 1, 28.95, 28.95, false, 5.00, 'Entrees', '{}'),
  -- Order 3: Outside date range
  ('stale-item-d', 'stale-order-3', '00000000-0000-0000-0000-290000000011', 'House Burger', 1, 16.95, 16.95, false, 0, 'Entrees', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price, is_voided = EXCLUDED.is_voided, discount_amount = EXCLUDED.discount_amount;

-- ============================================================
-- Fixture: Payments
-- ============================================================
INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('stale-pay-1', 'stale-order-1', '00000000-0000-0000-0000-290000000011', '2026-02-08', 'CREDIT', 80.00, 12.00, 'PAID', '{"refundStatus": "NONE"}'),
  -- Payment that will become VOIDED later
  ('stale-pay-2', 'stale-order-2', '00000000-0000-0000-0000-290000000011', '2026-02-09', 'CREDIT', 50.00, 8.00, 'PAID', '{"refundStatus": "NONE"}'),
  -- Refund payment for sign testing
  ('stale-pay-refund', 'stale-order-1', '00000000-0000-0000-0000-290000000011', '2026-02-08', 'CREDIT', 18.95, 0, 'REFUNDED', '{"refundStatus": "FULL", "refund": {"refundAmount": 1895}}')
ON CONFLICT (restaurant_id, toast_payment_guid) DO UPDATE
  SET amount = EXCLUDED.amount, tip_amount = EXCLUDED.tip_amount, payment_status = EXCLUDED.payment_status, raw_json = EXCLUDED.raw_json;


-- ============================================================
-- PHASE 1: Initial sync (everything active, no stale data)
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011');


-- ============================================================
-- TEST CATEGORY 1: Authorization
-- ============================================================

-- Test 1: Authorized owner can call single-arg overload
SELECT lives_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011')$$,
  'Authorized owner can call single-arg overload'
);

-- Test 2: Authorized owner can call date-range overload
SELECT lives_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011', '2026-02-01'::date, '2026-02-28'::date)$$,
  'Authorized owner can call date-range overload'
);

-- Test 3: Unauthorized user is blocked (single-arg)
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000002"}';
SELECT throws_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011')$$,
  'P0001',
  'Unauthorized: user does not have access to this restaurant',
  'Unauthorized user blocked from single-arg overload'
);

-- Test 4: Unauthorized user is blocked (date-range)
SELECT throws_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011', '2026-02-01'::date, '2026-02-28'::date)$$,
  'P0001',
  'Unauthorized: user does not have access to this restaurant',
  'Unauthorized user blocked from date-range overload'
);

-- Test 5: Service-role bypass (no JWT = auth.uid() IS NULL)
RESET "request.jwt.claims";
SET LOCAL role TO postgres;
SELECT lives_ok(
  $$SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011')$$,
  'Service-role (no JWT) bypasses authorization check'
);

-- ============================================================
-- TEST CATEGORY 2: Initial sync baseline verification
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';

-- Test 6: Sale entries created for active items
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'sale'),
  4::bigint,
  'Initial sync: 4 sale entries (items a, b, c, d)'
);

-- Test 7: Discount entry for item-b ($3 off Caesar Salad)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b_discount'
     AND item_type = 'discount'),
  -3.00::numeric,
  'Initial sync: discount entry for item-b is -$3.00'
);

-- Test 8: Discount entry for item-c ($5 off Grilled Salmon)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-c_discount'
     AND item_type = 'discount'),
  -5.00::numeric,
  'Initial sync: discount entry for item-c is -$5.00'
);

-- Test 9: Tax entries for all 3 orders
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'tax'),
  3::bigint,
  'Initial sync: 3 tax entries (orders 1, 2, 3)'
);

-- Test 10: Tip entries for paid payments
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'tip'),
  2::bigint,
  'Initial sync: 2 tip entries (pay-1 and pay-2)'
);

-- Test 11: Refund entry with correct negative sign
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-pay-refund_refund'
     AND item_type = 'refund'),
  -18.95::numeric,
  'Refund entry: -$18.95 (negative amount)'
);


-- ============================================================
-- PHASE 2: Simulate stale data scenarios
-- Mark items as voided, zero out tax, void a payment
-- ============================================================
SET LOCAL role TO postgres;

-- Void item-a (Margherita Pizza) - was a $18.95 sale
UPDATE toast_order_items SET is_voided = true
WHERE toast_item_guid = 'stale-item-a'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

-- Void item-c (Grilled Salmon) - had a $5.00 discount
UPDATE toast_order_items SET is_voided = true
WHERE toast_item_guid = 'stale-item-c'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

-- Zero out tax on order-2 (simulating full comp)
UPDATE toast_orders SET tax_amount = 0
WHERE toast_order_guid = 'stale-order-2'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

-- Void payment-2's status (tip should be removed)
UPDATE toast_payments SET payment_status = 'VOIDED'
WHERE toast_payment_guid = 'stale-pay-2'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';


-- ============================================================
-- PHASE 3: Re-run sync — stale entries should be cleaned
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011');


-- ============================================================
-- TEST CATEGORY 3: Stale sale deletion (Step 0a)
-- ============================================================

-- Test 12: Voided item-a sale entry deleted
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-a'
     AND item_type = 'sale'),
  0::bigint,
  'Step 0a: voided item-a sale entry deleted'
);

-- Test 13: Voided item-c sale entry deleted
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-c'
     AND item_type = 'sale'),
  0::bigint,
  'Step 0a: voided item-c sale entry deleted'
);

-- Test 14: Non-voided item-b sale still exists
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b'
     AND item_type = 'sale'),
  12.95::numeric,
  'Step 0a: non-voided item-b sale preserved ($12.95)'
);

-- Test 15: Non-voided item-d sale still exists
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-d'
     AND item_type = 'sale'),
  16.95::numeric,
  'Step 0a: non-voided item-d sale preserved ($16.95)'
);

-- Test 16: Only 2 sale entries remain (b and d)
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'sale'),
  2::bigint,
  'Step 0a: only 2 sale entries remain after cleanup'
);


-- ============================================================
-- TEST CATEGORY 4: Stale tax deletion (Step 0b)
-- ============================================================

-- Test 17: Zero-tax order-2 tax entry deleted
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-order-2_tax'
     AND item_type = 'tax'),
  0::bigint,
  'Step 0b: $0-tax order-2 tax entry deleted'
);

-- Test 18: Order-1 tax entry preserved ($6.40)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-order-1_tax'
     AND item_type = 'tax'),
  6.40::numeric,
  'Step 0b: order-1 tax preserved ($6.40)'
);

-- Test 19: Order-3 tax entry preserved ($2.40)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-order-3_tax'
     AND item_type = 'tax'),
  2.40::numeric,
  'Step 0b: order-3 tax preserved ($2.40)'
);

-- Test 20: Only 2 tax entries remain
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'tax'),
  2::bigint,
  'Step 0b: only 2 tax entries remain after cleanup'
);


-- ============================================================
-- TEST CATEGORY 5: Stale discount deletion (Step 0c)
-- ============================================================

-- Test 21: Voided item-c discount entry deleted
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-c_discount'
     AND item_type = 'discount'
     AND adjustment_type = 'discount'),
  0::bigint,
  'Step 0c: voided item-c discount entry deleted'
);

-- Test 22: Non-voided item-b discount preserved (-$3.00)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b_discount'
     AND item_type = 'discount'),
  -3.00::numeric,
  'Step 0c: non-voided item-b discount preserved (-$3.00)'
);


-- ============================================================
-- TEST CATEGORY 6: Stale tip deletion (Step 5a)
-- ============================================================

-- Test 23: Voided payment-2 tip entry deleted
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-pay-2_tip'
     AND item_type = 'tip'),
  0::bigint,
  'Step 5a: voided payment-2 tip entry deleted'
);

-- Test 24: Paid payment-1 tip preserved ($12.00)
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-pay-1_tip'
     AND item_type = 'tip'),
  12.00::numeric,
  'Step 5a: paid payment-1 tip preserved ($12.00)'
);

-- Test 25: Only 1 tip entry remains
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND pos_system = 'toast' AND item_type = 'tip'),
  1::bigint,
  'Step 5a: only 1 tip entry remains after cleanup'
);


-- ============================================================
-- TEST CATEGORY 7: Void offset entries (Step 3)
-- ============================================================

-- Test 26: Voided item-a has a void offset entry
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-a_void'
     AND adjustment_type = 'void'),
  -18.95::numeric,
  'Void offset: item-a void entry is -$18.95'
);

-- Test 27: Voided item-c has a void offset entry
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-c_void'
     AND adjustment_type = 'void'),
  -28.95::numeric,
  'Void offset: item-c void entry is -$28.95'
);


-- ============================================================
-- TEST CATEGORY 8: Upsert semantics (update existing rows)
-- ============================================================

-- Test 28: Re-running sync doesn't create duplicates
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';

SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011');

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b'
     AND item_type = 'sale'),
  1::bigint,
  'Upsert: re-running sync does not create duplicate sale entries'
);

-- Test 29: Upsert updates values when source data changes
SET LOCAL role TO postgres;
UPDATE toast_order_items SET item_name = 'Caesar Salad (Large)'
WHERE toast_item_guid = 'stale-item-b'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011');

SELECT is(
  (SELECT item_name FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b'
     AND item_type = 'sale'),
  'Caesar Salad (Large)',
  'Upsert: item_name updated on re-sync'
);

-- Test 30: synced_at is refreshed on upsert
SELECT ok(
  (SELECT synced_at FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-b'
     AND item_type = 'sale') >= NOW() - INTERVAL '5 seconds',
  'Upsert: synced_at refreshed to current time'
);


-- ============================================================
-- TEST CATEGORY 9: Date-range overload filtering
-- ============================================================

-- Re-activate item-a so we can test date-range filtering
SET LOCAL role TO postgres;
UPDATE toast_order_items SET is_voided = false
WHERE toast_item_guid = 'stale-item-a'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

-- Also void item-d (order-3, Jan 15) to test out-of-range voided items
UPDATE toast_order_items SET is_voided = true
WHERE toast_item_guid = 'stale-item-d'
  AND restaurant_id = '00000000-0000-0000-0000-290000000011';

-- Run date-range sync for Feb only
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-290000000001"}';
SELECT sync_toast_to_unified_sales(
  '00000000-0000-0000-0000-290000000011',
  '2026-02-01'::date,
  '2026-02-28'::date
);

-- Test 31: Item-a (Feb 8) sale restored by date-range sync
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-a'
     AND item_type = 'sale'),
  1::bigint,
  'Date-range: re-activated item-a (Feb 8) sale restored'
);

-- Test 32: Item-d (Jan 15) is outside Feb range - its stale sale should NOT be cleaned
-- (The date-range overload only deletes within the date range)
SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-d'
     AND item_type = 'sale'),
  1::bigint,
  'Date-range: item-d (Jan 15) sale NOT deleted by Feb-only sync'
);

-- Test 33: Now run single-arg overload to clean ALL stale data
SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-290000000011');

SELECT is(
  (SELECT COUNT(*) FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-d'
     AND item_type = 'sale'),
  0::bigint,
  'Single-arg: item-d (Jan 15) stale sale deleted by full sync'
);

-- Test 34: Item-d void offset created
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-item-d_void'
     AND adjustment_type = 'void'),
  -16.95::numeric,
  'Single-arg: item-d void offset is -$16.95'
);


-- ============================================================
-- TEST CATEGORY 10: Sign and negative handling
-- ============================================================

-- Test 35: All discount entries are negative
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
      AND pos_system = 'toast'
      AND item_type = 'discount'
      AND adjustment_type = 'discount'
      AND total_price >= 0
  ),
  'Sign check: all discount entries have negative total_price'
);

-- Test 36: All void entries are negative
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
      AND pos_system = 'toast'
      AND adjustment_type = 'void'
      AND total_price >= 0
  ),
  'Sign check: all void entries have negative total_price'
);

-- Test 37: All sale entries are positive
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
      AND pos_system = 'toast'
      AND item_type = 'sale'
      AND total_price <= 0
  ),
  'Sign check: all sale entries have positive total_price'
);

-- Test 38: Tax entries are positive
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
      AND pos_system = 'toast'
      AND item_type = 'tax'
      AND total_price <= 0
  ),
  'Sign check: all tax entries have positive total_price'
);

-- Test 39: Tip entries are positive
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
      AND pos_system = 'toast'
      AND item_type = 'tip'
      AND total_price <= 0
  ),
  'Sign check: all tip entries have positive total_price'
);

-- Test 40: Refund entry is negative
SELECT is(
  (SELECT total_price FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-290000000011'
     AND external_item_id = 'stale-pay-refund_refund'
     AND item_type = 'refund'),
  -18.95::numeric,
  'Sign check: refund entry is negative (-$18.95)'
);


-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
