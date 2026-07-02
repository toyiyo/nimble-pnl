-- pgTAP: focus_orders, focus_order_items, focus_payments schema + RLS
-- Migration: 20260701120000_focus_transactions.sql
-- RED → GREEN: run BEFORE the migration to confirm failures, then after to confirm green.
--
-- Tests:
--   1-3:   Table existence (3 tables)
--   4-10:  Key column existence
--   11-13: Named UNIQUE constraints (for ON CONFLICT)
--   14-16: Composite indexes (restaurant_id, business_date)
--   17-19: RLS enabled on each table
--   20-22: SELECT policy: all three tables have a SELECT policy
--   23-25: FOR ALL policy: all three tables have a FOR ALL (owner/manager) policy
--   26-28: Rows cascade-deleted when restaurant is deleted
--   29-31: NOT NULL on required columns
--   32:    focus_orders.focus_check_id not null
--   33:    focus_order_items.item_key not null
--   34:    focus_payments.payment_key not null

BEGIN;
SELECT plan(34);

-- ─────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO public.restaurants (id, name, address, phone)
VALUES
  ('00000000-0000-0000-0001-f0c0aa000001'::uuid, 'Focus Txn Test R1', '1 Test St', '555-0001'),
  ('00000000-0000-0000-0001-f0c0aa000002'::uuid, 'Focus Txn Test R2', '2 Test St', '555-0002')
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────
-- 1-3: Table existence
-- ─────────────────────────────────────────────────────────────────────
SELECT has_table('public', 'focus_orders',       'focus_orders table exists');
SELECT has_table('public', 'focus_order_items',  'focus_order_items table exists');
SELECT has_table('public', 'focus_payments',     'focus_payments table exists');

-- ─────────────────────────────────────────────────────────────────────
-- 4-10: Key column existence
-- ─────────────────────────────────────────────────────────────────────
-- focus_orders
SELECT has_column('public', 'focus_orders', 'restaurant_id',    'focus_orders.restaurant_id exists');
SELECT has_column('public', 'focus_orders', 'business_date',    'focus_orders.business_date exists');
SELECT has_column('public', 'focus_orders', 'focus_check_id',   'focus_orders.focus_check_id exists');
SELECT has_column('public', 'focus_orders', 'total',            'focus_orders.total exists');

-- focus_order_items
SELECT has_column('public', 'focus_order_items', 'item_key',         'focus_order_items.item_key exists');
SELECT has_column('public', 'focus_order_items', 'is_modifier',      'focus_order_items.is_modifier exists');
SELECT has_column('public', 'focus_order_items', 'report_group_id',  'focus_order_items.report_group_id exists');

-- ─────────────────────────────────────────────────────────────────────
-- 11-13: Named UNIQUE constraints exist (used in ON CONFLICT clauses)
-- ─────────────────────────────────────────────────────────────────────
SELECT has_index(
  'public', 'focus_orders',
  'focus_orders_unique',
  'focus_orders has focus_orders_unique constraint'
);

SELECT has_index(
  'public', 'focus_order_items',
  'focus_order_items_unique',
  'focus_order_items has focus_order_items_unique constraint'
);

SELECT has_index(
  'public', 'focus_payments',
  'focus_payments_unique',
  'focus_payments has focus_payments_unique constraint'
);

-- ─────────────────────────────────────────────────────────────────────
-- 14-16: Composite indexes on (restaurant_id, business_date)
-- ─────────────────────────────────────────────────────────────────────
SELECT has_index(
  'public', 'focus_orders',
  'focus_orders_rid_date_idx',
  'focus_orders has focus_orders_rid_date_idx'
);

SELECT has_index(
  'public', 'focus_order_items',
  'focus_order_items_rid_date_idx',
  'focus_order_items has focus_order_items_rid_date_idx'
);

SELECT has_index(
  'public', 'focus_payments',
  'focus_payments_rid_date_idx',
  'focus_payments has focus_payments_rid_date_idx'
);

-- ─────────────────────────────────────────────────────────────────────
-- 17-19: RLS enabled on each table
-- ─────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'focus_orders' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS is enabled on focus_orders'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'focus_order_items' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS is enabled on focus_order_items'
);

SELECT is(
  (SELECT relrowsecurity FROM pg_class
    WHERE relname = 'focus_payments' AND relnamespace = 'public'::regnamespace),
  true,
  'RLS is enabled on focus_payments'
);

-- ─────────────────────────────────────────────────────────────────────
-- 20-22: SELECT policy — member can read (all three tables)
--   We verify by checking the policy rows in pg_policies.
-- ─────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_orders'
      AND cmd = 'SELECT'
  ),
  'focus_orders has a SELECT policy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_order_items'
      AND cmd = 'SELECT'
  ),
  'focus_order_items has a SELECT policy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_payments'
      AND cmd = 'SELECT'
  ),
  'focus_payments has a SELECT policy'
);

-- ─────────────────────────────────────────────────────────────────────
-- 23-25: FOR ALL policy exists on each transaction table
-- ─────────────────────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_orders'
      AND cmd = 'ALL'
  ),
  'focus_orders has a FOR ALL (owner/manager) policy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_order_items'
      AND cmd = 'ALL'
  ),
  'focus_order_items has a FOR ALL (owner/manager) policy'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'focus_payments'
      AND cmd = 'ALL'
  ),
  'focus_payments has a FOR ALL (owner/manager) policy'
);

-- ─────────────────────────────────────────────────────────────────────
-- 26-28: ON DELETE CASCADE — rows removed when restaurant deleted
-- ─────────────────────────────────────────────────────────────────────
-- Seed parent restaurant and child rows
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0001-f0c0aa000099'::uuid, 'Cascade Test R', '99 Test St', '555-9999')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.focus_orders
  (restaurant_id, business_date, focus_check_id, total)
VALUES
  ('00000000-0000-0000-0001-f0c0aa000099', '2026-06-29', 'CHK-CASC-1', 50.00);

INSERT INTO public.focus_order_items
  (restaurant_id, business_date, focus_check_id, item_key, name)
VALUES
  ('00000000-0000-0000-0001-f0c0aa000099', '2026-06-29', 'CHK-CASC-1', 'IKEY-1', 'Test Item');

INSERT INTO public.focus_payments
  (restaurant_id, business_date, focus_check_id, payment_key, amount)
VALUES
  ('00000000-0000-0000-0001-f0c0aa000099', '2026-06-29', 'CHK-CASC-1', 'PKEY-1', 50.00);

-- Delete the restaurant; child rows must cascade
DELETE FROM public.restaurants WHERE id = '00000000-0000-0000-0001-f0c0aa000099';

SELECT is(
  (SELECT COUNT(*)::int FROM public.focus_orders
    WHERE restaurant_id = '00000000-0000-0000-0001-f0c0aa000099'),
  0,
  'focus_orders rows cascade-deleted with restaurant'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.focus_order_items
    WHERE restaurant_id = '00000000-0000-0000-0001-f0c0aa000099'),
  0,
  'focus_order_items rows cascade-deleted with restaurant'
);

SELECT is(
  (SELECT COUNT(*)::int FROM public.focus_payments
    WHERE restaurant_id = '00000000-0000-0000-0001-f0c0aa000099'),
  0,
  'focus_payments rows cascade-deleted with restaurant'
);

-- ─────────────────────────────────────────────────────────────────────
-- 29-31: NOT NULL on required columns (via failed INSERT)
-- ─────────────────────────────────────────────────────────────────────
-- focus_orders.restaurant_id NOT NULL
SELECT throws_ok(
  $$INSERT INTO public.focus_orders (restaurant_id, business_date, focus_check_id, total)
    VALUES (NULL, '2026-06-29', 'X', 0)$$,
  NULL, NULL,
  'focus_orders.restaurant_id is NOT NULL'
);

-- focus_order_items.restaurant_id NOT NULL
SELECT throws_ok(
  $$INSERT INTO public.focus_order_items (restaurant_id, business_date, focus_check_id, item_key, name)
    VALUES (NULL, '2026-06-29', 'X', 'K1', 'Item')$$,
  NULL, NULL,
  'focus_order_items.restaurant_id is NOT NULL'
);

-- focus_payments.restaurant_id NOT NULL
SELECT throws_ok(
  $$INSERT INTO public.focus_payments (restaurant_id, business_date, focus_check_id, payment_key, amount)
    VALUES (NULL, '2026-06-29', 'X', 'PK1', 0)$$,
  NULL, NULL,
  'focus_payments.restaurant_id is NOT NULL'
);

-- ─────────────────────────────────────────────────────────────────────
-- 32-34: Critical identifier columns NOT NULL
-- ─────────────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$INSERT INTO public.focus_orders (restaurant_id, business_date, focus_check_id, total)
    VALUES ('00000000-0000-0000-0001-f0c0aa000001', '2026-06-29', NULL, 0)$$,
  NULL, NULL,
  'focus_orders.focus_check_id is NOT NULL'
);

SELECT throws_ok(
  $$INSERT INTO public.focus_order_items (restaurant_id, business_date, focus_check_id, item_key, name)
    VALUES ('00000000-0000-0000-0001-f0c0aa000001', '2026-06-29', 'CHK-1', NULL, 'Item')$$,
  NULL, NULL,
  'focus_order_items.item_key is NOT NULL'
);

SELECT throws_ok(
  $$INSERT INTO public.focus_payments (restaurant_id, business_date, focus_check_id, payment_key, amount)
    VALUES ('00000000-0000-0000-0001-f0c0aa000001', '2026-06-29', 'CHK-1', NULL, 0)$$,
  NULL, NULL,
  'focus_payments.payment_key is NOT NULL'
);

SELECT * FROM finish();
ROLLBACK;
