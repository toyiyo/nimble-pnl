-- Tests for focus fee-item revenue classification
-- Migration: 20260719154500_focus_fee_classification.sql
--
-- Design: docs/superpowers/specs/2026-07-19-focus-fee-classification-design.md
--
-- Section 1: _focus_is_fee_item predicate
--   Third-party delivery fee line items (Dispatch Fee, Dispatch Service Fee,
--   RailsUpcharge, ...) should be identified as pass-through fees by
--   case-insensitive name pattern, NOT counted as real sale items.
--
-- Section 2: end-to-end classification via
--   _sync_focus_transactions_to_unified_sales_impl (design cases 2-9):
--   mixed check (dessert sale + Dispatch Fee), fee-only phantom check
--   (Dispatch Service Fee only), fee-as-sale backfill cleanup (with and
--   without a user split child), voided fee check, discounted-fee check,
--   idempotency, and the get_unified_sales_totals read-layer contract.

BEGIN;
SELECT plan(35);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 1: _focus_is_fee_item predicate
-- ─────────────────────────────────────────────────────────────────────────────

SELECT ok(
  public._focus_is_fee_item('Dispatch Fee'),
  '_focus_is_fee_item: TRUE for ''Dispatch Fee'''
);

SELECT ok(
  public._focus_is_fee_item('Dispatch Service Fee'),
  '_focus_is_fee_item: TRUE for ''Dispatch Service Fee'''
);

SELECT ok(
  public._focus_is_fee_item('Dispatch Fee2'),
  '_focus_is_fee_item: TRUE for ''Dispatch Fee2'''
);

SELECT ok(
  public._focus_is_fee_item('RailsUpcharge'),
  '_focus_is_fee_item: TRUE for ''RailsUpcharge'''
);

SELECT ok(
  public._focus_is_fee_item('Rails Upcharge'),
  '_focus_is_fee_item: TRUE for ''Rails Upcharge'''
);

SELECT ok(
  NOT public._focus_is_fee_item('CLYellow Cake'),
  '_focus_is_fee_item: FALSE for ''CLYellow Cake'' (real sale item)'
);

SELECT ok(
  NOT public._focus_is_fee_item('Dispatch Tip'),
  '_focus_is_fee_item: FALSE for ''Dispatch Tip'' (tip, not fee)'
);

SELECT ok(
  NOT public._focus_is_fee_item(NULL),
  '_focus_is_fee_item: FALSE for NULL'
);

SELECT ok(
  NOT public._focus_is_fee_item(''),
  '_focus_is_fee_item: FALSE for empty string'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section 2: end-to-end classification via
-- _sync_focus_transactions_to_unified_sales_impl
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Setup: one active focus_connections + focus_orders/focus_order_items
-- covering:
--   Check 100 (2026-07-16): mixed  — CLYellow Cake (dessert, sale) +
--                            Dispatch Fee (1.99, fee).
--   Check 101 (2026-07-16): fee-only "phantom" — Dispatch Service Fee (2.99).
--   Check 104 (2026-07-17): backfill cleanup — Dispatch Fee (1.99), with a
--                            pre-seeded legacy item_type='sale' base row
--                            under the un-suffixed external_item_id.
--   Check 105 (2026-07-17): split-child backfill cleanup — RailsUpcharge
--                            (3.25), with a pre-seeded legacy sale base row
--                            PLUS a user split child (parent_sale_id set).
--   Check 102 (2026-07-18): voided fee check — Dispatch Fee (1.99), synced
--                            once while NOT voided (to prove the fee row
--                            existed), then voided and re-synced.
--   Check 103 (2026-07-19): discounted fee — Dispatch Service Fee (3.50)
--                            with discount_amount = -0.50.

SET LOCAL role TO postgres;
ALTER TABLE public.restaurants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_orders          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_order_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_payments        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales         DISABLE ROW LEVEL SECURITY;

-- Auth user (owner) — needed for get_unified_sales_totals, which gates on
-- user_restaurants membership via auth.uid().
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-f0c200000001',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'ffee-owner@test.com', crypt('pw', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c200000011', 'Focus Fee Test Kitchen', '1 Dispatch Way', '555-0094')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-f0c200000001', '00000000-0000-0000-0000-f0c200000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- focus_connections (store_id = 'GUID-FEE-STORE')
INSERT INTO public.focus_connections (
  id, restaurant_id, store_id,
  api_key, api_secret_encrypted, environment,
  is_active, connection_status, initial_sync_done, last_sync_time
) VALUES (
  '00000000-0000-0000-0000-f0c200000021',
  '00000000-0000-0000-0000-f0c200000011',
  'GUID-FEE-STORE',
  'test-api-key', 'enc-placeholder', 'production',
  true, 'connected', true,
  now() - interval '3 days'
)
ON CONFLICT (restaurant_id) DO UPDATE SET store_id = 'GUID-FEE-STORE';

-- ── Check 100 (2026-07-16): mixed — dessert + Dispatch Fee ────────────────
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000031',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-16', '100',
  '2026-07-16T10:00:00', '2026-07-16T10:15:00',
  8.49, 0.00, 6.50
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 8.49;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000041',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-16', '100', 'IK-DESSERT',
   'RN-101', 'IC-101', 'CLYellow Cake', '20',
   6.50, NULL, false, 0.00),
  ('00000000-0000-0000-0000-f0c200000042',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-16', '100', 'IK-FEE1',
   'RN-102', 'IC-102', 'Dispatch Fee', '94',
   1.99, NULL, false, 0.00)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- ── Check 101 (2026-07-16): fee-only "phantom" — Dispatch Service Fee ─────
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000032',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-16', '101',
  '2026-07-16T11:00:00', '2026-07-16T11:05:00',
  2.99, 0.00, 0.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 2.99;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000043',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-16', '101', 'IK-FEE2',
   'RN-103', 'IC-102', 'Dispatch Service Fee', '94',
   2.99, NULL, false, 0.00)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- ── Check 104 (2026-07-17): backfill cleanup — Dispatch Fee, pre-seeded ───
-- with a legacy item_type='sale' base row under the un-suffixed id (as a
-- pre-migration sync would have left it).
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000033',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-17', '104',
  '2026-07-17T12:00:00', '2026-07-17T12:05:00',
  1.99, 0.00, 0.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 1.99;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000044',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-17', '104', 'IK-FEE3',
   'RN-104', 'IC-102', 'Dispatch Fee', '94',
   1.99, NULL, false, 0.00)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

INSERT INTO public.unified_sales (
  restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c200000011', 'focus',
  'focus-GUID-FEE-STORE-20260717-104', 'focus-GUID-FEE-STORE-20260717-104__IK-FEE3',
  'Dispatch Fee', 1, 1.99, 1.99,
  '2026-07-17', 'sale', now() - interval '1 hour'
)
ON CONFLICT (restaurant_id, pos_system, external_order_id, external_item_id)
  WHERE parent_sale_id IS NULL
DO NOTHING;

-- ── Check 105 (2026-07-17): split-child backfill cleanup — RailsUpcharge ──
-- Legacy fee-as-sale base row PLUS a user split child (parent_sale_id set).
-- unified_sales carries a redundant NO-ACTION parent_sale_id FK alongside
-- the ON DELETE CASCADE fk_parent_sale — deleting the base row alone would
-- abort the whole sync unless the cleanup deletes base + child together.
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000034',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-17', '105',
  '2026-07-17T13:00:00', '2026-07-17T13:05:00',
  3.25, 0.00, 0.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 3.25;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000045',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-17', '105', 'IK-FEE4',
   'RN-105', 'IC-102', 'RailsUpcharge', '94',
   3.25, NULL, false, 0.00)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

INSERT INTO public.unified_sales (
  id, restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c200000055',
  '00000000-0000-0000-0000-f0c200000011', 'focus',
  'focus-GUID-FEE-STORE-20260717-105', 'focus-GUID-FEE-STORE-20260717-105__IK-FEE4',
  'RailsUpcharge', 1, 3.25, 3.25,
  '2026-07-17', 'sale', now() - interval '1 hour'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.unified_sales (
  id, restaurant_id, pos_system,
  external_order_id, external_item_id,
  item_name, quantity, unit_price, total_price,
  sale_date, item_type, parent_sale_id, synced_at
) VALUES (
  '00000000-0000-0000-0000-f0c200000056',
  '00000000-0000-0000-0000-f0c200000011', 'focus',
  'focus-GUID-FEE-STORE-20260717-105', 'focus-GUID-FEE-STORE-20260717-105__IK-FEE4-split',
  'RailsUpcharge (split)', 1, 1.00, 1.00,
  '2026-07-17', 'sale', '00000000-0000-0000-0000-f0c200000055', now() - interval '1 hour'
)
ON CONFLICT (id) DO NOTHING;

-- ── Check 102 (2026-07-18): voided fee check — Dispatch Fee ────────────────
-- Starts NOT voided so the first sync actually creates its fee row; voided
-- and re-synced later (case 8).
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000035',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-18', '102',
  '2026-07-18T14:00:00', '2026-07-18T14:05:00',
  1.99, 0.00, 0.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 1.99, is_voided = false, voided_at = NULL;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000046',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-18', '102', 'IK-FEE5',
   'RN-106', 'IC-102', 'Dispatch Fee', '94',
   1.99, NULL, false, 0.00)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- ── Check 103 (2026-07-19): discounted fee — Dispatch Service Fee ─────────
-- Focus XML stores DiscountAmount as negative.
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local, total, discount_total, taxable_sales
) VALUES (
  '00000000-0000-0000-0000-f0c200000036',
  '00000000-0000-0000-0000-f0c200000011',
  '2026-07-19', '103',
  '2026-07-19T15:00:00', '2026-07-19T15:05:00',
  3.00, 0.50, 0.00
)
ON CONFLICT ON CONSTRAINT focus_orders_unique DO UPDATE SET total = 3.00;

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000047',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-07-19', '103', 'IK-FEE6',
   'RN-107', 'IC-102', 'Dispatch Service Fee', '94',
   3.50, NULL, false, -0.50)
ON CONFLICT ON CONSTRAINT focus_order_items_unique DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- First sync: covers 2026-07-16..2026-07-19 (check 102 still NOT voided).
-- ─────────────────────────────────────────────────────────────────────────
SELECT _sync_focus_transactions_to_unified_sales_impl(
  '00000000-0000-0000-0000-f0c200000011'::uuid,
  '2026-07-16'::date, '2026-07-19'::date
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 2: mixed check (100) — dessert row is a plain sale, NULL adjustment
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT item_type FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260716-100__IK-DESSERT'),
  'sale',
  'Mixed check: dessert row item_type=''sale'''
);

SELECT ok(
  (SELECT adjustment_type FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260716-100__IK-DESSERT') IS NULL,
  'Mixed check: dessert row adjustment_type IS NULL'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 3: mixed check (100) — Dispatch Fee row is a pass-through fee
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT item_type FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260716-100__IK-FEE1_fee'),
  'other',
  'Mixed check: Dispatch Fee row item_type=''other'''
);

SELECT is(
  (SELECT adjustment_type FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260716-100__IK-FEE1_fee'),
  'fee',
  'Mixed check: Dispatch Fee row adjustment_type=''fee'''
);

SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260716-100__IK-FEE1_fee'),
  1.99::numeric,
  'Mixed check: Dispatch Fee row total_price=1.99'
);

SELECT ok(
  right(
    (SELECT external_item_id FROM public.unified_sales
     WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
       AND adjustment_type = 'fee'),
    4
  ) = '_fee',
  'Mixed check: fee row external_item_id ends in ''_fee'' (literal suffix)'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 4: get_unified_sales_totals — revenue excludes fees; pass_through
-- and collected_at_pos include them (date range = 2026-07-16 only, so the
-- totals cover exactly checks 100 + 101).
-- ─────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c200000001"}';

SELECT is(
  (SELECT revenue FROM public.get_unified_sales_totals(
     '00000000-0000-0000-0000-f0c200000011'::uuid, '2026-07-16'::date, '2026-07-16'::date)),
  6.50::numeric,
  'get_unified_sales_totals: revenue excludes both fee rows (only the 6.50 dessert counts)'
);

SELECT is(
  (SELECT pass_through_amount FROM public.get_unified_sales_totals(
     '00000000-0000-0000-0000-f0c200000011'::uuid, '2026-07-16'::date, '2026-07-16'::date)),
  4.98::numeric,
  'get_unified_sales_totals: pass_through_amount includes both fees (1.99 + 2.99 = 4.98)'
);

SELECT is(
  (SELECT collected_at_pos FROM public.get_unified_sales_totals(
     '00000000-0000-0000-0000-f0c200000011'::uuid, '2026-07-16'::date, '2026-07-16'::date)),
  11.48::numeric,
  'get_unified_sales_totals: collected_at_pos includes fees (6.50 + 1.99 + 2.99 = 11.48)'
);

SET LOCAL role TO postgres;

-- ─────────────────────────────────────────────────────────────────────────
-- Case 5: fee-only "phantom" check (101) — $0 revenue, fee still pass-through
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-101'
     AND item_type = 'sale'),
  0,
  'Phantom check: no item_type=''sale'' row (fee is the only line item)'
);

SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-101'
     AND adjustment_type = 'fee'),
  2.99::numeric,
  'Phantom check: Dispatch Service Fee row total_price=2.99'
);

SELECT is(
  (SELECT COALESCE(SUM(total_price), 0)::numeric FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-101'
     AND item_type = 'sale'
     AND adjustment_type IS NULL),
  0::numeric,
  'Phantom check: revenue contribution is 0 (not suppressed — row exists, just excluded)'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 6: backfill cleanup (check 104) — legacy fee-as-sale row is deleted
-- and replaced by the '_fee' row.
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260717-104'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260717-104__IK-FEE3'),
  0,
  'Backfill cleanup: legacy fee-as-sale base row (un-suffixed id) is deleted'
);

SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260717-104'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260717-104__IK-FEE3_fee'
     AND adjustment_type = 'fee'),
  1.99::numeric,
  'Backfill cleanup: replaced by a ''_fee'' row with total_price=1.99'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 6b: split-child backfill cleanup (check 105) — base row AND its
-- split child are BOTH deleted in one shot (no FK-violation abort).
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260717-105'
     AND external_item_id IN (
       'focus-GUID-FEE-STORE-20260717-105__IK-FEE4',
       'focus-GUID-FEE-STORE-20260717-105__IK-FEE4-split'
     )),
  0,
  'Split-child backfill cleanup: legacy base row AND its split child are both deleted'
);

SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260717-105'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260717-105__IK-FEE4_fee'
     AND adjustment_type = 'fee'),
  3.25::numeric,
  'Split-child backfill cleanup: replaced by a ''_fee'' row with total_price=3.25 (no FK abort)'
);

SELECT is(
  (SELECT COALESCE(SUM(total_price), 0)::numeric FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260717-105'
     AND item_type = 'sale'
     AND adjustment_type IS NULL),
  0::numeric,
  'Split-child backfill cleanup: revenue excludes the reclassified fee (no sale row survives)'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Precondition for case 8: check 102's fee row exists BEFORE it is voided,
-- so "no leftover _fee row after voiding" below is a meaningful assertion.
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260718-102'
     AND adjustment_type = 'fee'),
  1.99::numeric,
  'Voided-check precondition: Dispatch Fee row (1.99) exists before voiding'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 9: discounted fee (check 103, price 3.50, discount -0.50) — emits ONE
-- 'fee' row NET of the discount (total_price = 3.00), NOT a gross 3.50 row and
-- NOT a spurious 'discount' row. Netting keeps pass_through_amount /
-- collected_at_pos (bare SUMs of total_price) matching what the POS collected.
-- ─────────────────────────────────────────────────────────────────────────
SELECT is(
  (SELECT total_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260719-103'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260719-103__IK-FEE6_fee'
     AND adjustment_type = 'fee'),
  3.00::numeric,
  'Discounted fee: ''fee'' row total_price is NET of discount (3.50 - 0.50 = 3.00)'
);

SELECT is(
  (SELECT unit_price FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260719-103'
     AND external_item_id = 'focus-GUID-FEE-STORE-20260719-103__IK-FEE6_fee'
     AND adjustment_type = 'fee'),
  3.00::numeric,
  'Discounted fee: ''fee'' row unit_price is NET of discount (quantity=1)'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260719-103'
     AND item_type = 'discount'),
  0,
  'Discounted fee: no spurious adjustment_type=''discount'' row for the fee item'
);

-- collected-side proof: the order's entire unified_sales footprint (all
-- non-void rows) sums to the net 3.00 the POS actually collected — no
-- overstatement from the discounted fee.
SELECT is(
  (SELECT COALESCE(SUM(total_price), 0) FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260719-103'
     AND adjustment_type IS DISTINCT FROM 'void'),
  3.00::numeric,
  'Discounted fee: collected-side SUM(total_price) = net 3.00 (no overstatement)'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 7: idempotency — re-run the same sync; row counts and identities are
-- unchanged (no duplicates from re-inserting fee/backfill/discount rows).
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE pre_second_sync_snapshot AS
SELECT COUNT(*)::integer AS row_count
FROM public.unified_sales
WHERE restaurant_id = '00000000-0000-0000-0000-f0c200000011';

SELECT _sync_focus_transactions_to_unified_sales_impl(
  '00000000-0000-0000-0000-f0c200000011'::uuid,
  '2026-07-16'::date, '2026-07-19'::date
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c200000011'),
  (SELECT row_count FROM pre_second_sync_snapshot),
  'Idempotency: re-running the sync leaves the total row count unchanged'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260716-100'
     AND adjustment_type = 'fee'),
  1,
  'Idempotency: exactly one fee row for check 100''s Dispatch Fee (no duplicate)'
);

-- ─────────────────────────────────────────────────────────────────────────
-- Case 8: voided fee check (102) — flip is_voided and re-sync just that
-- date. The whole check's footprint (including the fee row) collapses into
-- a single adjustment_type='void' marker.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE public.focus_orders
SET is_voided = true, voided_at = now()
WHERE restaurant_id = '00000000-0000-0000-0000-f0c200000011'
  AND business_date = '2026-07-18'
  AND focus_check_id = '102';

SELECT _sync_focus_transactions_to_unified_sales_impl(
  '00000000-0000-0000-0000-f0c200000011'::uuid,
  '2026-07-18'::date, '2026-07-18'::date
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260718-102'
     AND adjustment_type = 'void'),
  1,
  'Voided fee check: exactly one adjustment_type=''void'' marker'
);

SELECT is(
  (SELECT COUNT(*)::integer FROM public.unified_sales
   WHERE external_order_id = 'focus-GUID-FEE-STORE-20260718-102'
     AND adjustment_type = 'fee'),
  0,
  'Voided fee check: no leftover ''_fee'' row after voiding'
);

SELECT * FROM finish();
ROLLBACK;
