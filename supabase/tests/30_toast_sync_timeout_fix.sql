-- pgTAP tests for Toast sync timeout fix
-- Tests migration: 20260215200000_fix_toast_sync_timeout.sql
--
-- Verifies that sync_toast_to_unified_sales disables the
-- auto_categorize_pos_sale trigger during bulk upserts and
-- batch-categorizes afterward, preventing statement timeouts.

BEGIN;
SELECT plan(12);

-- ============================================================
-- Setup
-- ============================================================
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE categorization_rules DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;

-- Test user
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-300000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sync-timeout-owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-300000000011', 'Sync Timeout Test Restaurant', '100 Timeout Ave', '555-3000')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-300000000001', '00000000-0000-0000-0000-300000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Chart of accounts entry for categorization rules
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES ('00000000-0000-0000-0000-300000000099', '00000000-0000-0000-0000-300000000011', '4000-TEST-30', 'Food Revenue', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO NOTHING;

-- Categorization rule that matches "Pizza" items (auto_apply = true)
INSERT INTO categorization_rules (id, restaurant_id, rule_name, applies_to, item_name_pattern, item_name_match_type, category_id, priority, is_active, auto_apply)
VALUES ('00000000-0000-0000-0000-300000000088', '00000000-0000-0000-0000-300000000011', 'Pizza Rule', 'pos_sales', 'Pizza', 'contains', '00000000-0000-0000-0000-300000000099', 10, true, true)
ON CONFLICT (id) DO NOTHING;

-- Toast order with 2 items
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json) VALUES
  ('00000000-0000-0000-0000-300000000021', 'timeout-order-1', '00000000-0000-0000-0000-300000000011', 'timeout-rest-guid', '2026-02-15', '12:00:00', 40.00, 3.20, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount, tax_amount = EXCLUDED.tax_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json) VALUES
  ('timeout-item-a', 'timeout-order-1', '00000000-0000-0000-0000-300000000011', 'Margherita Pizza', 1, 22.00, 22.00, false, 0, 'Entrees', '{}'),
  ('timeout-item-b', 'timeout-order-1', '00000000-0000-0000-0000-300000000011', 'Caesar Salad', 1, 14.00, 14.00, false, 0, 'Salads', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price, is_voided = EXCLUDED.is_voided;

-- Payment with tip
INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json) VALUES
  ('timeout-pay-1', 'timeout-order-1', '00000000-0000-0000-0000-300000000011', '2026-02-15', 'CREDIT', 40.00, 6.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- ============================================================
-- TEST: Sync completes without error
-- ============================================================
SELECT lives_ok(
  $q$ SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-300000000011'::UUID) $q$,
  'sync_toast_to_unified_sales completes without timeout'
);

-- TEST: Correct number of unified_sales rows created (sale x2 + tax + tip = 4)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'),
  4,
  'Sync created 4 unified_sales rows (2 sales + 1 tax + 1 tip)'
);

-- TEST: Pizza sale item was batch-categorized
SELECT is(
  (SELECT is_categorized FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND external_item_id = 'timeout-item-a'
     AND item_type = 'sale'),
  true,
  'Pizza sale item was categorized by batch step'
);

SELECT is(
  (SELECT category_id FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND external_item_id = 'timeout-item-a'
     AND item_type = 'sale'),
  '00000000-0000-0000-0000-300000000099'::UUID,
  'Pizza sale item has correct category_id from rule'
);

-- TEST: Non-matching sale item (Caesar Salad) remains uncategorized
SELECT is(
  (SELECT is_categorized FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND external_item_id = 'timeout-item-b'
     AND item_type = 'sale'),
  false,
  'Non-matching sale item remains uncategorized'
);

-- TEST: Tax row is NOT categorized (non-sale type)
SELECT is(
  (SELECT is_categorized FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND item_type = 'tax'),
  false,
  'Tax row is not categorized'
);

-- TEST: Tip row is NOT categorized (non-sale type)
SELECT is(
  (SELECT is_categorized FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND item_type = 'tip'),
  false,
  'Tip row is not categorized'
);

-- TEST: Categorization rule apply_count was incremented
SELECT is(
  (SELECT apply_count FROM categorization_rules WHERE id = '00000000-0000-0000-0000-300000000088'),
  1,
  'Categorization rule apply_count incremented to 1'
);

-- ============================================================
-- TEST: Date-range overload also works
-- ============================================================

-- Clear previous sync data
DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-300000000011';

-- Reset rule apply_count
UPDATE categorization_rules SET apply_count = 0 WHERE id = '00000000-0000-0000-0000-300000000088';

SELECT lives_ok(
  $q$ SELECT sync_toast_to_unified_sales(
    '00000000-0000-0000-0000-300000000011'::UUID,
    '2026-02-15'::DATE,
    '2026-02-15'::DATE
  ) $q$,
  'Date-range sync completes without timeout'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'),
  4,
  'Date-range sync created 4 unified_sales rows'
);

SELECT is(
  (SELECT is_categorized FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-300000000011'
     AND external_item_id = 'timeout-item-a'
     AND item_type = 'sale'),
  true,
  'Date-range sync: Pizza sale item was categorized'
);

-- Verify trigger is still enabled after sync
SELECT is(
  (SELECT tgenabled FROM pg_trigger WHERE tgname = 'auto_categorize_pos_sale' AND tgrelid = 'public.unified_sales'::regclass),
  'O',
  'Trigger is re-enabled after sync'
);

SELECT * FROM finish();
ROLLBACK;
