-- pgTAP tests for Revel POS integration
-- Tests migration: 20260706120000_revel_integration.sql
-- Covers: revel_sync_financial_breakdown RPC, sync_revel_to_unified_sales RPC, RLS isolation

BEGIN;
SELECT plan(11);

-- Setup: Disable RLS for test data creation (mirrors supabase/tests/17_toast_sync_authorization.sql)
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE revel_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Create test users (member + non-member) for RLS check
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('00000000-0000-0000-0000-300000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revel-owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-300000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'revel-outsider@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Fixtures: restaurant (only id/name required; other columns have defaults)
INSERT INTO public.restaurants (id, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Revel Test A')
ON CONFLICT (id) DO NOTHING;

-- Link owner user to the restaurant (outsider stays unlinked for RLS test)
INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-300000000001', '11111111-1111-1111-1111-111111111111', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO public.revel_connections (restaurant_id, revel_instance, establishment_id, webhook_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'reveltesta', 'est-1', true);

-- subtotal_amount = sum of non-voided items (20.00) so the bulk-sync reconciliation
-- line nets to zero; service_charge exercises the auto-gratuity path.
INSERT INTO public.revel_orders (id, restaurant_id, revel_order_id, order_date, order_time, sold_at,
  subtotal_amount, total_amount, tax_amount, tip_amount, discount_amount, service_charge_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'order-1', '2026-07-01', '12:30:00', '2026-07-01T12:30:00Z', 20.00, 25.00, 2.00, 3.00, 1.00, 1.50);

INSERT INTO public.revel_order_items (restaurant_id, revel_order_id_fk, revel_order_id, revel_item_id,
  item_name, quantity, unit_price, total_price, is_voided)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-1', 'Burger', 1, 20.00, 20.00, false),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-2', 'Voided Fry', 1, 5.00, 5.00, true);

-- ============================================================
-- Financial breakdown RPC
-- ============================================================

-- Test 1: breakdown inserts sale + tax + tip + discount + service_charge, excludes voided item
SELECT is(public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'), 5,
  'breakdown inserts sale + tax + tip + discount + service_charge, excludes voided item');

-- Test 2: exactly one non-voided sale row
SELECT is((SELECT count(*)::int FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND pos_system = 'revel' AND item_type = 'sale'), 1,
  'exactly one non-voided sale row');

-- Test 3: discount row stored as negative amount
SELECT ok((SELECT total_price FROM public.unified_sales WHERE external_item_id = 'order-1:discount') < 0,
  'discount row stored as negative amount');

-- Test 4: service charge row emitted with item_type = 'service_charge'
SELECT is((SELECT count(*)::int FROM public.unified_sales
   WHERE external_item_id = 'order-1:service_charge' AND item_type = 'service_charge'), 1,
  'breakdown emits a service_charge adjustment row');

-- Test 5: second breakdown call is a true no-op — sold_at is unchanged, so the
-- self-heal DO UPDATE's `IS DISTINCT FROM` guard skips every row (0 rows written,
-- no dead tuples, no trigger churn). Real corrections still propagate (see test 8).
SELECT is(public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'), 0,
  'second breakdown call writes 0 rows when sold_at is unchanged (no-op guard)');

-- ============================================================
-- Bulk sync RPC
-- ============================================================
-- Prime: bulk sync settles the rows breakdown does not emit (per-order reconciliation
-- + voided/returned/refund informational lines). subtotal=20 nets the reconcile line to
-- zero, so the only new row here is the voided-item informational line.
SELECT public.sync_revel_to_unified_sales('11111111-1111-1111-1111-111111111111', NULL, NULL);

-- Test 6: bulk sync emits a voided informational row (item_type 'other', excluded from Net Sales)
SELECT is((SELECT count(*)::int FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
     AND external_item_id = 'item-2:void' AND item_type = 'other'), 1,
  'bulk sync emits a voided informational row excluded from net sales');

-- Test 7: repeat bulk sync is a true no-op — sold_at unchanged across every
-- conflicting block (sale, tax, tip, discount, service_charge, voided-item), so
-- the DO UPDATE `IS DISTINCT FROM` guard skips them all (0 rows written).
SELECT is(public.sync_revel_to_unified_sales('11111111-1111-1111-1111-111111111111', NULL, NULL), 0,
  'repeat bulk sync writes 0 rows when sold_at is unchanged (no-op guard)');

-- ============================================================
-- Self-heal: DO UPDATE propagates corrected sold_at without clobbering categorization
-- (T5 — mirrors Toast's RPC: a later re-sync of an existing order must not leave
-- unified_sales.sold_at stale relative to revel_orders.sold_at, e.g. post-backfill)
-- ============================================================

-- Simulate a user having categorized the sale row before any re-sync
UPDATE public.unified_sales SET is_categorized = true
WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
  AND pos_system = 'revel' AND external_item_id = 'item-1';

-- Simulate a backfill/correction to revel_orders.sold_at (the timezone fix's authoritative source)
UPDATE public.revel_orders SET sold_at = '2026-07-01T17:45:00+00'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111');

-- Test 8: breakdown RPC self-heal propagates the corrected sold_at into the existing row
SELECT ok((SELECT sold_at FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
     AND pos_system = 'revel' AND external_item_id = 'item-1') = '2026-07-01T17:45:00+00'::timestamptz,
  'breakdown self-heal propagates corrected sold_at into existing unified_sales row');

-- Test 9: breakdown RPC self-heal preserves user categorization (is_categorized untouched)
SELECT ok((SELECT is_categorized FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
     AND pos_system = 'revel' AND external_item_id = 'item-1'),
  'breakdown self-heal preserves is_categorized (does not clobber categorization)');

-- Simulate a second, later backfill correction and verify the bulk-sync RPC self-heals too
UPDATE public.revel_orders SET sold_at = '2026-07-01T18:15:00+00'
WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

SELECT public.sync_revel_to_unified_sales('11111111-1111-1111-1111-111111111111', NULL, NULL);

-- Test 10: bulk sync RPC self-heal propagates the corrected sold_at into the existing tax row
SELECT ok((SELECT sold_at FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
     AND pos_system = 'revel' AND external_item_id = 'order-1:tax') = '2026-07-01T18:15:00+00'::timestamptz,
  'bulk sync self-heal propagates corrected sold_at into existing unified_sales row');

-- ============================================================
-- RLS isolation
-- ============================================================

-- Re-enable RLS and simulate an authenticated non-member user
ALTER TABLE revel_connections ENABLE ROW LEVEL SECURITY;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-300000000002"}';

-- Test 11: RLS hides connections from non-members
SELECT is((SELECT count(*)::int FROM public.revel_connections
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'), 0,
  'RLS hides connections from non-members');

SELECT * FROM finish();
ROLLBACK;
