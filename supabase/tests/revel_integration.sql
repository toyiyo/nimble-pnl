-- pgTAP tests for Revel POS integration
-- Tests migration: 20260706120000_revel_integration.sql
-- Covers: revel_sync_financial_breakdown RPC, sync_revel_to_unified_sales RPC, RLS isolation

BEGIN;
SELECT plan(6);

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

INSERT INTO public.revel_orders (id, restaurant_id, revel_order_id, order_date, order_time, sold_at,
  total_amount, tax_amount, tip_amount, discount_amount)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
  'order-1', '2026-07-01', '12:30:00', '2026-07-01T12:30:00Z', 25.00, 2.00, 3.00, 1.00);

INSERT INTO public.revel_order_items (restaurant_id, revel_order_id_fk, revel_order_id, revel_item_id,
  item_name, quantity, unit_price, total_price, is_voided)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-1', 'Burger', 1, 20.00, 20.00, false),
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'order-1', 'item-2', 'Voided Fry', 1, 5.00, 5.00, true);

-- ============================================================
-- Financial breakdown RPC
-- ============================================================

-- Test 1: breakdown inserts sale + tax + tip + discount, excludes voided item
SELECT is(public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'), 4,
  'breakdown inserts sale + tax + tip + discount, excludes voided item');

-- Test 2: exactly one non-voided sale row
SELECT is((SELECT count(*)::int FROM public.unified_sales
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND pos_system = 'revel' AND item_type = 'sale'), 1,
  'exactly one non-voided sale row');

-- Test 3: discount row stored as negative amount
SELECT ok((SELECT total_price FROM public.unified_sales WHERE external_item_id = 'order-1:discount') < 0,
  'discount row stored as negative amount');

-- Test 4: second breakdown call is idempotent
SELECT is(public.revel_sync_financial_breakdown('order-1', '11111111-1111-1111-1111-111111111111'), 0,
  'second breakdown call is idempotent');

-- ============================================================
-- Bulk sync RPC
-- ============================================================

-- Test 5: bulk sync is idempotent against already-synced sale rows
SELECT is(public.sync_revel_to_unified_sales('11111111-1111-1111-1111-111111111111', NULL, NULL), 0,
  'bulk sync is idempotent against already-synced sale rows');

-- ============================================================
-- RLS isolation
-- ============================================================

-- Re-enable RLS and simulate an authenticated non-member user
ALTER TABLE revel_connections ENABLE ROW LEVEL SECURITY;
SET LOCAL role = authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-300000000002"}';

-- Test 6: RLS hides connections from non-members
SELECT is((SELECT count(*)::int FROM public.revel_connections
   WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'), 0,
  'RLS hides connections from non-members');

SELECT * FROM finish();
ROLLBACK;
