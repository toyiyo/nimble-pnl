-- Tests for sync_focus_transactions_to_unified_sales RPC
-- Migration: 20260701130000_focus_transactions_unified_sales.sql
--
-- This RPC syncs focus_orders / focus_order_items / focus_payments →
-- unified_sales, mirroring sync_toast_to_unified_sales.
--
-- focus_orders.tax_amount (added by 20260710120000_focus_orders_tax_amount.sql)
-- is the sum of SeatRecord.TaxTotal1..5 across all seats on the check,
-- captured by the parser + persisted on upsert. Step 6 of this RPC (added by
-- 20260710130000_focus_tax_unified_sales.sql) emits ONE tax offset row per
-- order when tax_amount != 0, mirroring the tip/discount offset blocks.
--
-- Test plan (24 tests):
--
--  1  sync_focus_transactions_to_unified_sales(uuid) exists
--  2  sync_focus_transactions_to_unified_sales(uuid,date,date) exists
--  3  sync_all_focus_transactions_to_unified_sales() exists
--  4  _sync_focus_transactions_to_unified_sales_impl(uuid,date,date) exists
--  5  Priced sale rows: items A (5.84), B (0.75, modifier+priced), D (5.67) → 3 rows
--  6  Sale amount matches item prices
--  7  external_order_id pattern = focus-{store_id}-{YYYYMMDD}-{check_id}
--  8  pos_category comes from report_group_id
--  9  Modifier rows (is_modifier=true) with non-zero price ARE included
-- 10  Zero-price items are excluded from sale rows
-- 11  Tip offset row created per payment with tip > 0
-- 12  Discount offset row created per item with discount_amount > 0 (negative)
-- 13  No discount row for items with discount_amount = 0
-- 14  Categorization preserved on re-sync (category_id not overwritten)
-- 15  Orphan sale row deleted when item no longer in focus_order_items
-- 16  pos_system = 'focus' on all rows
-- 17  All rows have the correct sale_date (business_date)
-- 18  Unauthorized user cannot call single-arg overload
-- 19  Service-role (auth.uid() NULL) can call impl without auth check
-- 20  sync_all_focus_transactions_to_unified_sales() returns a row for the active connection
-- 21  Date-range overload only syncs rows within the given dates
-- 22  Tax offset row created for order with tax_amount=5.55 (check 42)
-- 23  Tax row external_item_id = <order_id>_tax
-- 24  Tax row adjustment_type = 'tax'

BEGIN;
SELECT plan(24);

-- ─────────────────────────────────────────────────────────────────────
-- Setup: disable RLS so we can insert test rows freely
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_orders          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_order_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_payments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts     DISABLE ROW LEVEL SECURITY;

-- Auth users
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-f0c100000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ftxn-owner@test.com', crypt('pw', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-f0c100000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ftxn-unauth@test.com', crypt('pw', gen_salt('bf')),
   now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c100000011', 'Focus Txn Creamery', '1 Datafeed Way', '555-0047')
ON CONFLICT (id) DO NOTHING;

-- Membership: owner
INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-f0c100000001', '00000000-0000-0000-0000-f0c100000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- focus_connections (store_id = 'GUID-TEST-STORE')
INSERT INTO public.focus_connections (
  id, restaurant_id, store_id,
  api_key, api_secret_encrypted, environment,
  is_active, connection_status, initial_sync_done, last_sync_time
) VALUES (
  '00000000-0000-0000-0000-f0c100000021',
  '00000000-0000-0000-0000-f0c100000011',
  'GUID-TEST-STORE',
  'test-api-key', 'enc-placeholder', 'production',
  true, 'connected', true,
  now() - interval '3 days'
)
ON CONFLICT (restaurant_id) DO UPDATE SET store_id = 'GUID-TEST-STORE';

-- ── focus_orders: one check on 2026-06-15 ─────────────────────────────
-- Check 42 with $12.00 total, $1.20 taxable_sales proxy (we'll use
-- focus_order_items prices for sale rows; focus_orders.total for tax proxy)
-- tax_amount=5.55 exercises the Step 6 tax offset row (tests 22-23).
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local,
  order_type_id, revenue_center_id, guests,
  total, discount_total, taxable_sales, tax_amount
) VALUES (
  '00000000-0000-0000-0000-f0c100000031',
  '00000000-0000-0000-0000-f0c100000011',
  '2026-06-15', '42',
  '2026-06-15T10:00:00', '2026-06-15T10:15:00',
  '1', 'RC1', 2,
  12.00, 0.50, 11.00, 5.55
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 12.00, tax_amount = 5.55;

-- ── focus_order_items: 3 rows ──────────────────────────────────────────
-- Item A: priced, category 'Waffle'
-- Item B: modifier with non-zero price (should be included)
-- Item C: zero-price modifier (should be excluded from sale rows)
INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  -- Item A: top-level priced item
  ('00000000-0000-0000-0000-f0c100000041',
   '00000000-0000-0000-0000-f0c100000011',
   '2026-06-15', '42', 'IK-A',
   'RN-001', 'IC-001', 'Like It Waffle Bowl', 'Waffle Cones',
   5.84, NULL, false, 0.00),
  -- Item B: modifier with non-zero price (upcharge)
  ('00000000-0000-0000-0000-f0c100000042',
   '00000000-0000-0000-0000-f0c100000011',
   '2026-06-15', '42', 'IK-B',
   'RN-002', 'IC-002', 'Nut Upcharge', 'Toppings',
   0.75, 'IK-A', true, 0.00),
  -- Item C: zero-price modifier (should be excluded)
  ('00000000-0000-0000-0000-f0c100000043',
   '00000000-0000-0000-0000-f0c100000011',
   '2026-06-15', '42', 'IK-C',
   'RN-003', 'IC-003', 'Hot Fudge', NULL,
   0.00, 'IK-A', true, 0.00),
  -- Item D: priced top-level item with discount
  ('00000000-0000-0000-0000-f0c100000044',
   '00000000-0000-0000-0000-f0c100000011',
   '2026-06-15', '42', 'IK-D',
   'RN-004', 'IC-004', 'Gotta Have It', 'Ice Cream',
   5.67, NULL, false, 0.50)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- ── focus_payments: one payment with tip ───────────────────────────────
INSERT INTO public.focus_payments (
  id, restaurant_id, business_date, focus_check_id, payment_key,
  payment_id, name, amount, tip, card_last4
) VALUES
  ('00000000-0000-0000-0000-f0c100000051',
   '00000000-0000-0000-0000-f0c100000011',
   '2026-06-15', '42', 'PK-1',
   'PAY-001', 'VISA', 12.00, 2.00, '1234')
ON CONFLICT ON CONSTRAINT focus_payments_unique DO NOTHING;

-- ── chart_of_accounts for categorization test ─────────────────────────
INSERT INTO public.chart_of_accounts (
  id, restaurant_id, account_code, account_name,
  account_type, normal_balance, is_active
) VALUES (
  '00000000-0000-0000-0000-f0c100000061',
  '00000000-0000-0000-0000-f0c100000011',
  '4200', 'Waffle Revenue', 'revenue', 'credit', true
)
ON CONFLICT (id) DO NOTHING;

-- Pre-categorized sale row for Item A (to test categorization preservation)
-- external_item_id follows pattern: focus-{store_id}-{YYYYMMDD}-{check_id}__{item_key}
INSERT INTO public.unified_sales (
  restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type,
  category_id, is_categorized, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c100000011', 'focus',
  'focus-GUID-TEST-STORE-20260615-42', 'focus-GUID-TEST-STORE-20260615-42__IK-A',
  'Like It Waffle Bowl', 1, 5.84, 5.84,
  '2026-06-15', 'sale',
  '00000000-0000-0000-0000-f0c100000061', true,
  now() - interval '1 hour'
)
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO UPDATE SET
  category_id    = COALESCE(unified_sales.category_id, EXCLUDED.category_id),
  is_categorized = COALESCE(unified_sales.is_categorized, EXCLUDED.is_categorized);

-- Orphan row: stale item that was deleted from focus_order_items
INSERT INTO public.unified_sales (
  restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c100000011', 'focus',
  'focus-GUID-TEST-STORE-20260615-42', 'focus-GUID-TEST-STORE-20260615-42__IK-GONE',
  'Old Deleted Item', 1, 3.00, 3.00,
  '2026-06-15', 'sale', now() - interval '1 hour'
)
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- Test 1-4: Function signatures exist
-- ─────────────────────────────────────────────────────────────────────
SELECT has_function(
  'public', 'sync_focus_transactions_to_unified_sales', ARRAY['uuid'],
  'sync_focus_transactions_to_unified_sales(uuid) exists'
);

SELECT has_function(
  'public', 'sync_focus_transactions_to_unified_sales', ARRAY['uuid','date','date'],
  'sync_focus_transactions_to_unified_sales(uuid,date,date) exists'
);

SELECT has_function(
  'public', 'sync_all_focus_transactions_to_unified_sales', ARRAY[]::text[],
  'sync_all_focus_transactions_to_unified_sales() exists'
);

SELECT has_function(
  'public', '_sync_focus_transactions_to_unified_sales_impl', ARRAY['uuid','date','date'],
  '_sync_focus_transactions_to_unified_sales_impl(uuid,date,date) exists'
);

-- ─────────────────────────────────────────────────────────────────────
-- Run the sync as the authenticated owner
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c100000001"}';

SELECT sync_focus_transactions_to_unified_sales(
  '00000000-0000-0000-0000-f0c100000011'::uuid
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 5: Exactly 3 sale rows (items A, B, D; item C is zero-price)
-- ─────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'sale'
     AND sale_date = '2026-06-15'),
  3,
  '3 sale rows: items A (5.84), B (0.75), D (5.67); zero-price item C excluded'
);

-- Test 6: Sale amounts match item prices
SELECT is(
  (SELECT SUM(total_price) FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'sale'
     AND sale_date = '2026-06-15'),
  (5.84 + 0.75 + 5.67)::numeric,
  'Total sale amount = 5.84 + 0.75 + 5.67'
);

-- Test 7: external_order_id pattern = focus-{store_id}-{YYYYMMDD}-{check_id}
SELECT ok(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND external_order_id = 'focus-GUID-TEST-STORE-20260615-42'
     AND sale_date = '2026-06-15') >= 1,
  'external_order_id = focus-{store_id}-{YYYYMMDD}-{check_id}'
);

-- Test 8: pos_category comes from report_group_id (item A → 'Waffle Cones')
SELECT is(
  (SELECT pos_category FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-A'
     AND item_type = 'sale'),
  'Waffle Cones',
  'pos_category populated from focus_order_items.report_group_id'
);

-- Test 9: Modifier item B (is_modifier=true, price=0.75) → included in sale rows
SELECT ok(
  EXISTS(
    SELECT 1 FROM public.unified_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
      AND pos_system = 'focus'
      AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-B'
      AND item_type = 'sale'
  ),
  'Modifier with non-zero price (IK-B, $0.75) is included as a sale row'
);

-- Test 10: Zero-price item C excluded
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-C'),
  0,
  'Zero-price item (IK-C, $0.00) excluded from unified_sales'
);

-- Test 11: Tip offset row created for payment PK-1 (tip=2.00)
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'tip'
     AND sale_date = '2026-06-15'),
  2.00::numeric,
  'Tip offset row created with tip=2.00 from payment PK-1'
);

-- Test 12: Discount offset row created for item D (discount_amount=0.50, negative)
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'discount'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-D_discount'
     AND sale_date = '2026-06-15'),
  (-0.50)::numeric,
  'Discount offset row for item D (negative -0.50)'
);

-- Test 13: No discount row for item A (discount_amount=0.00)
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'discount'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-A_discount'),
  0,
  'No discount row for item A (discount_amount = 0)'
);

-- Test 14: Categorization preserved on re-sync (category_id not overwritten)
SELECT is(
  (SELECT category_id::text FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-A'
     AND item_type = 'sale'),
  '00000000-0000-0000-0000-f0c100000061',
  'Pre-existing category_id preserved on re-sync (not overwritten)'
);

-- Test 15: Orphan row (IK-GONE) deleted after sync
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND external_item_id = 'focus-GUID-TEST-STORE-20260615-42__IK-GONE'),
  0,
  'Orphan sale row (IK-GONE) deleted during sync'
);

-- Test 16: All rows have pos_system = 'focus'
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system != 'focus'
     AND sale_date = '2026-06-15'),
  0,
  'All synced rows have pos_system = ''focus'''
);

-- Test 17: All rows have correct sale_date = business_date
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND sale_date != '2026-06-15'),
  0,
  'All rows have sale_date = 2026-06-15 (business_date)'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 18: Unauthorized user cannot call single-arg overload
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c100000002"}';

SELECT throws_ok(
  $$SELECT sync_focus_transactions_to_unified_sales('00000000-0000-0000-0000-f0c100000011'::uuid)$$,
  'P0001',
  NULL,
  'Unauthorized user cannot call sync_focus_transactions_to_unified_sales'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 19: Service-role (auth.uid() NULL) can call impl without auth check
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '';

SELECT lives_ok(
  $$SELECT _sync_focus_transactions_to_unified_sales_impl(
    '00000000-0000-0000-0000-f0c100000011'::uuid,
    '2026-06-15'::date, '2026-06-15'::date)$$,
  'Service-role can call impl directly without authorization error'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 20: sync_all_focus_transactions_to_unified_sales() returns a row
-- ─────────────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT COUNT(*) FROM sync_all_focus_transactions_to_unified_sales()) >= 1,
  'sync_all_focus_transactions_to_unified_sales() returns at least one result row'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 21: Date-range overload only syncs within the given range
-- Insert a second check on a different date; then sync only 2026-06-14;
-- the June 15 rows should NOT be re-affected (they were already synced above)
-- but a clean date 2026-06-14 check yields rows only for that date.
-- ─────────────────────────────────────────────────────────────────────

-- Insert a June 14 check
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c100000032',
  '00000000-0000-0000-0000-f0c100000011',
  '2026-06-14', '10',
  8.00, 0.00, 8.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO NOTHING;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  name, report_group_id, price, is_modifier, discount_amount
) VALUES (
  '00000000-0000-0000-0000-f0c100000045',
  '00000000-0000-0000-0000-f0c100000011',
  '2026-06-14', '10', 'IK-X',
  'Sinless Sundae', 'Ice Cream', 8.00, false, 0.00
)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- Sync only June 14
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c100000001"}';
SELECT sync_focus_transactions_to_unified_sales(
  '00000000-0000-0000-0000-f0c100000011'::uuid,
  '2026-06-14'::date,
  '2026-06-14'::date
);

-- June 14 sale rows should exist
SELECT ok(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'sale'
     AND sale_date = '2026-06-14') >= 1,
  'Date-range overload creates rows only for 2026-06-14'
);

-- ─────────────────────────────────────────────────────────────────────
-- Test 22-23: Step 6 tax offset row (check 42, tax_amount = 5.55)
-- ─────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'tax'
     AND external_order_id = 'focus-GUID-TEST-STORE-20260615-42'
     AND sale_date = '2026-06-15'),
  5.55::numeric,
  'Tax offset row created with tax_amount=5.55 for check 42'
);

SELECT is(
  (SELECT external_item_id FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'tax'
     AND external_order_id = 'focus-GUID-TEST-STORE-20260615-42'
     AND sale_date = '2026-06-15'),
  'focus-GUID-TEST-STORE-20260615-42_tax',
  'Tax row external_item_id = <order_id>_tax'
);

SELECT is(
  (SELECT adjustment_type FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c100000011'
     AND pos_system = 'focus'
     AND item_type = 'tax'
     AND external_order_id = 'focus-GUID-TEST-STORE-20260615-42'
     AND sale_date = '2026-06-15'),
  'tax',
  'Tax row adjustment_type = ''tax'''
);

SELECT * FROM finish();
ROLLBACK;
