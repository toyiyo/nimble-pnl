-- Tests for sync_focus_to_unified_sales + sync_all_focus_to_unified_sales RPCs
-- Migration: <ts>_focus_unified_sales_sync.sql
--
-- Test plan:
--  1  Function exists (single-arg overload)
--  2  Function exists (three-arg overload)
--  3  sync_all_focus_to_unified_sales exists
--  4  Sale rows created for each item in items_json (count = 2)
--  5  Sale amounts match items_json values
--  6  Tax offset row created (adjustment_type='tax')
--  7  Tip offset row created (adjustment_type='tip')
--  8  No discount row when subtotal_discounts = 0
--  9  No refund row when refunds = 0
-- 10  pos_system = 'focus' on all rows
-- 11  external_order_id contains store_id + YYYYMMDD
-- 12  Orphan cleanup: stale external_item_id deleted after sync
-- 13  Categorization preserved: category_id unchanged on re-sync
-- 14  Unauthorized user cannot call single-arg overload
-- 15  sync_all_focus_to_unified_sales returns a result row

BEGIN;
SELECT plan(15);

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: disable RLS so we can insert test rows freely
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_daily_reports   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_of_accounts     DISABLE ROW LEVEL SECURITY;

-- Auth users
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES
  ('00000000-0000-0000-0000-f0c000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'focus-owner@test.com', crypt('pw', gen_salt('bf')),
   now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-f0c000000002',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'focus-unauth@test.com', crypt('pw', gen_salt('bf')),
   now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c000000011', 'Focus Test Creamery', '1 Ice Cream Way', '555-0042')
ON CONFLICT (id) DO NOTHING;

-- Membership: owner
INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-f0c000000001', '00000000-0000-0000-0000-f0c000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- focus_connections (store_id = 'S9999', needed for external_order_id + sync_all)
INSERT INTO public.focus_connections (
  id, restaurant_id, report_base_url, report_path, store_id,
  username, password_encrypted,
  is_active, connection_status, initial_sync_done, last_sync_time
) VALUES (
  '00000000-0000-0000-0000-f0c000000021',
  '00000000-0000-0000-0000-f0c000000011',
  'https://mfprod-1.myfocuspos.com',
  '/ReportServer?/generalstorereports/revenuecenter',
  'S9999',
  'sample.user', 'enc-placeholder',
  true, 'connected', true,
  now() - interval '3 days'
)
ON CONFLICT (restaurant_id) DO UPDATE SET store_id = 'S9999';

-- focus_daily_reports: one business day with 2 sale items
-- items_json carries name + sales; revenue_center = 'Cold Stone'
INSERT INTO public.focus_daily_reports (
  id, restaurant_id, business_date, revenue_center,
  net_sales, total_tax, subtotal_discounts, retained_tips, refunds,
  total_sales, total_payments,
  items_json, payments_json, order_types_json, raw_totals_json
) VALUES (
  '00000000-0000-0000-0000-f0c000000031',
  '00000000-0000-0000-0000-f0c000000011',
  '2026-06-01', 'Cold Stone',
  7.63, 1.76, 0, 3.82, 0,
  9.39, 9.39,
  '[{"name":"Waffle","sales":1.79},{"name":"Like It","sales":5.84}]',
  '[{"tender":"Cash","amount":9.39}]',
  '[]',
  '{}'
)
ON CONFLICT (restaurant_id, business_date, revenue_center)
DO UPDATE SET
  total_tax            = EXCLUDED.total_tax,
  retained_tips        = EXCLUDED.retained_tips,
  items_json           = EXCLUDED.items_json;

-- Category for categorization-preservation test
INSERT INTO public.chart_of_accounts (
  id, restaurant_id, account_code, account_name,
  account_type, normal_balance, is_active
) VALUES (
  '00000000-0000-0000-0000-f0c000000041',
  '00000000-0000-0000-0000-f0c000000011',
  '4100', 'Ice Cream Sales', 'revenue', 'credit', true
)
ON CONFLICT (id) DO NOTHING;

-- Orphan row: stale item that is NOT in the current items_json
-- (external_item_id = 'cold-stone_old-item')
INSERT INTO public.unified_sales (
  restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c000000011', 'focus',
  'focus-S9999-20260601', 'cold-stone_old-item',
  'Old Gone Item', 1, 2.50, 2.50,
  '2026-06-01', 'sale', now() - interval '1 hour'
)
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO NOTHING;

-- Pre-categorized row matching the current "Waffle" item
-- (external_item_id = 'cold-stone_waffle')
INSERT INTO public.unified_sales (
  restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type,
  category_id, is_categorized, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c000000011', 'focus',
  'focus-S9999-20260601', 'cold-stone_waffle',
  'Waffle', 1, 1.79, 1.79,
  '2026-06-01', 'sale',
  '00000000-0000-0000-0000-f0c000000041', true,
  now() - interval '1 hour'
)
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO UPDATE SET
  category_id    = COALESCE(unified_sales.category_id, EXCLUDED.category_id),
  is_categorized = COALESCE(unified_sales.is_categorized, EXCLUDED.is_categorized);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 1 & 2: Function signatures exist
-- ─────────────────────────────────────────────────────────────────────────────
SELECT has_function(
  'public', 'sync_focus_to_unified_sales', ARRAY['uuid'],
  'sync_focus_to_unified_sales(uuid) exists'
);

SELECT has_function(
  'public', 'sync_focus_to_unified_sales', ARRAY['uuid','date','date'],
  'sync_focus_to_unified_sales(uuid,date,date) exists'
);

-- Test 3: sync_all function exists
SELECT has_function(
  'public', 'sync_all_focus_to_unified_sales', ARRAY[]::text[],
  'sync_all_focus_to_unified_sales() exists'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Run the sync as an authenticated owner
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c000000001"}';

SELECT sync_focus_to_unified_sales('00000000-0000-0000-0000-f0c000000011'::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 4: Exactly 2 sale rows for the 2 items in items_json
-- ─────────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'sale'
     AND sale_date = '2026-06-01'),
  2,
  '2 sale rows created for the 2 items in items_json'
);

-- Test 5: Sale amounts match items_json values
SELECT is(
  (SELECT SUM(total_price) FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'sale'
     AND sale_date = '2026-06-01'),
  (1.79 + 5.84)::numeric,
  'Sale total matches sum of items_json sales (1.79 + 5.84)'
);

-- Test 6: Tax offset row (adjustment_type = 'tax', amount = 1.76)
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'tax'
     AND sale_date = '2026-06-01'),
  1.76::numeric,
  'Tax offset row created with correct amount (1.76)'
);

-- Test 7: Tip offset row (adjustment_type = 'tip', amount = 3.82)
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'tip'
     AND sale_date = '2026-06-01'),
  3.82::numeric,
  'Tip offset row created with correct amount (3.82)'
);

-- Test 8: No discount row when subtotal_discounts = 0
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'discount'
     AND sale_date = '2026-06-01'),
  0,
  'No discount row when subtotal_discounts = 0'
);

-- Test 9: No refund row when refunds = 0
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND item_type = 'refund'
     AND sale_date = '2026-06-01'),
  0,
  'No refund row when refunds = 0'
);

-- Test 10: pos_system = 'focus' on all rows
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system != 'focus'
     AND sale_date = '2026-06-01'),
  0,
  'All rows have pos_system = ''focus'''
);

-- Test 11: external_order_id follows the pattern focus-{store_id}-{YYYYMMDD}
SELECT ok(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND external_order_id = 'focus-S9999-20260601'
     AND sale_date = '2026-06-01') >= 1,
  'external_order_id follows focus-{store_id}-{YYYYMMDD} pattern'
);

-- Test 12: Orphan cleanup — stale row was deleted after sync
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND external_item_id = 'cold-stone_old-item'),
  0,
  'Orphan row (cold-stone_old-item) deleted during sync'
);

-- Test 13: Categorization preserved — category_id unchanged on re-sync
SELECT is(
  (SELECT category_id::text FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000011'
     AND pos_system = 'focus'
     AND external_item_id = 'cold-stone_waffle'
     AND item_type = 'sale'),
  '00000000-0000-0000-0000-f0c000000041',
  'Pre-existing category_id preserved on re-sync (not overwritten)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 14: Unauthorized user cannot call single-arg overload
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c000000002"}';

SELECT throws_ok(
  $$SELECT sync_focus_to_unified_sales('00000000-0000-0000-0000-f0c000000011'::uuid)$$,
  'P0001',
  NULL,
  'Unauthorized user cannot call sync_focus_to_unified_sales'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 15: sync_all returns at least one result row
-- Run as postgres (service-role analogue) with no jwt claims so auth.uid()
-- is NULL — exactly how the cron job calls it.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
-- Clear any stale jwt claims from the throws_ok test above so auth.uid() = NULL
SET LOCAL "request.jwt.claims" TO '';

SELECT ok(
  (SELECT COUNT(*) FROM sync_all_focus_to_unified_sales()) >= 1,
  'sync_all_focus_to_unified_sales() returns at least one result row'
);

SELECT * FROM finish();
ROLLBACK;
