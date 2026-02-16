-- pgTAP tests for Toast incremental sync
-- Tests migration: 20260216120000_toast_incremental_sync.sql
--
-- Verifies that sync_all_toast_to_unified_sales() uses date-range overload
-- with last_sync_time, and that toast_payments index exists.

BEGIN;
SELECT plan(8);

-- ============================================================
-- Setup
-- ============================================================
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Auth context for batch categorization
SELECT set_config(
  'request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-310000000001", "role": "authenticated"}',
  true
);

-- Test user
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-310000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'incr-sync-owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-310000000011', 'Incremental Sync Test Restaurant', '200 Incr Ave', '555-3100')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-310000000001', '00000000-0000-0000-0000-310000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Active toast connection with last_sync_time = 1 hour ago
INSERT INTO toast_connections (id, restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active, last_sync_time, connection_status, initial_sync_done)
VALUES (
  '00000000-0000-0000-0000-310000000099',
  '00000000-0000-0000-0000-310000000011',
  'test-client-id',
  'encrypted-secret',
  'incr-rest-guid',
  true,
  NOW() - INTERVAL '1 hour',
  'connected',
  true
)
ON CONFLICT (id) DO UPDATE SET last_sync_time = EXCLUDED.last_sync_time, is_active = EXCLUDED.is_active;

-- OLD order: 30 days ago (outside the 25-hour window)
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-310000000021', 'incr-old-order', '00000000-0000-0000-0000-310000000011', 'incr-rest-guid', CURRENT_DATE - 30, '10:00:00', 25.00, 2.00, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('incr-old-item', 'incr-old-order', '00000000-0000-0000-0000-310000000011', 'Old Pasta', 1, 25.00, 25.00, false, 0, 'Entrees', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET unit_price = EXCLUDED.unit_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('incr-old-pay', 'incr-old-order', '00000000-0000-0000-0000-310000000011', CURRENT_DATE - 30, 'CREDIT', 25.00, 3.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- RECENT order: today (inside the 25-hour window)
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-310000000022', 'incr-new-order', '00000000-0000-0000-0000-310000000011', 'incr-rest-guid', CURRENT_DATE, '14:00:00', 18.00, 1.50, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('incr-new-item', 'incr-new-order', '00000000-0000-0000-0000-310000000011', 'Fresh Salad', 1, 18.00, 18.00, false, 0, 'Salads', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET unit_price = EXCLUDED.unit_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('incr-new-pay', 'incr-new-order', '00000000-0000-0000-0000-310000000011', CURRENT_DATE, 'CREDIT', 18.00, 2.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- ============================================================
-- TEST 1: sync_all completes without error
-- ============================================================
SELECT lives_ok(
  $q$ SELECT * FROM sync_all_toast_to_unified_sales() $q$,
  'sync_all_toast_to_unified_sales completes without error'
);

-- TEST 2: Only RECENT order was synced (date-range scoping works)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-new-order'),
  3,
  'Recent order synced: 3 rows (sale + tax + tip)'
);

-- TEST 3: Old order was NOT synced (outside 25h window)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-old-order'),
  0,
  'Old order (30 days ago) was NOT synced by incremental cron'
);

-- TEST 4: Full sync still processes old orders (single-arg overload)
DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-310000000011';

SELECT lives_ok(
  $q$ SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-310000000011'::UUID) $q$,
  'Single-arg full sync completes without error'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-old-order'),
  3,
  'Full sync processes old order: 3 rows (sale + tax + tip)'
);

-- TEST 5: NULL last_sync_time falls back to 90-day window
DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-310000000011';
UPDATE toast_connections SET last_sync_time = NULL WHERE id = '00000000-0000-0000-0000-310000000099';

SELECT lives_ok(
  $q$ SELECT * FROM sync_all_toast_to_unified_sales() $q$,
  'sync_all handles NULL last_sync_time without error'
);

-- Both orders should be synced (both within 90-day fallback)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'),
  6,
  'NULL last_sync_time: both orders synced (6 rows total, 90-day fallback)'
);

-- TEST 6: toast_payments index exists
SELECT has_index(
  'public',
  'toast_payments',
  'idx_toast_payments_restaurant_date',
  'toast_payments(restaurant_id, payment_date) index exists'
);

SELECT * FROM finish();
ROLLBACK;
