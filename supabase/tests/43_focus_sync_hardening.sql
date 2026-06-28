-- Tests for focus_sync_hardening migration
-- Migration: 20260627150000_focus_sync_hardening.sql
--
-- Test plan:
--  1  _sync_focus_to_unified_sales_impl is NOT executable by anon role
--  2  sync_all_focus_to_unified_sales is NOT executable by anon role
--  3  sync_all_focus_to_unified_sales is NOT executable by authenticated role
--  4  sync_focus_to_unified_sales(uuid) IS executable by authenticated role
--  5  Tax offset external_item_id includes revenue_center slug
--  6  Tip offset external_item_id includes revenue_center slug
--  7  sync_all_focus_to_unified_sales updates last_sync_time

BEGIN;
SELECT plan(7);

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_daily_reports   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales         DISABLE ROW LEVEL SECURITY;

-- Auth user
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) VALUES (
  '00000000-0000-0000-0000-f0c000000101',
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'focus-h-owner@test.com', crypt('pw', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c000000111', 'Focus Hardening Test', '1 Test Ln', '555-0099')
ON CONFLICT (id) DO NOTHING;

-- Membership
INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-f0c000000101', '00000000-0000-0000-0000-f0c000000111', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Connection (last_sync_time = 2 days ago so sync_all picks it up)
INSERT INTO public.focus_connections (
  id, restaurant_id, report_base_url, report_path, store_id,
  username, password_encrypted,
  is_active, connection_status, initial_sync_done, last_sync_time
) VALUES (
  '00000000-0000-0000-0000-f0c000000121',
  '00000000-0000-0000-0000-f0c000000111',
  'https://mfprod-1.myfocuspos.com',
  '/ReportServer?/generalstorereports/revenuecenter',
  'SH999',
  'sample.user', 'enc-placeholder',
  true, 'connected', true,
  now() - interval '2 days'
)
ON CONFLICT (restaurant_id) DO UPDATE SET
  store_id       = 'SH999',
  last_sync_time = now() - interval '2 days';

-- Daily report: revenue_center = 'Drive-Through', non-zero tax + tip
INSERT INTO public.focus_daily_reports (
  id, restaurant_id, business_date, revenue_center,
  net_sales, total_tax, subtotal_discounts, retained_tips, refunds,
  total_sales, total_payments,
  items_json, payments_json, order_types_json, raw_totals_json
) VALUES (
  '00000000-0000-0000-0000-f0c000000131',
  '00000000-0000-0000-0000-f0c000000111',
  '2026-06-02', 'Drive-Through',
  10.00, 1.00, 0, 0.50, 0,
  11.00, 11.00,
  '[{"name":"Shake","sales":10.00}]',
  '[{"tender":"Visa","amount":11.00}]',
  '[]', '{}'
)
ON CONFLICT (restaurant_id, business_date, revenue_center)
DO UPDATE SET
  total_tax     = EXCLUDED.total_tax,
  retained_tips = EXCLUDED.retained_tips,
  items_json    = EXCLUDED.items_json;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tests 1-3: Permission checks (REVOKE)
-- ─────────────────────────────────────────────────────────────────────────────

-- Test 1: anon cannot execute the impl function
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public._sync_focus_to_unified_sales_impl(uuid,date,date)',
    'EXECUTE'
  ),
  'anon role cannot EXECUTE _sync_focus_to_unified_sales_impl'
);

-- Test 2: anon cannot execute sync_all
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.sync_all_focus_to_unified_sales()',
    'EXECUTE'
  ),
  'anon role cannot EXECUTE sync_all_focus_to_unified_sales'
);

-- Test 3: authenticated cannot execute sync_all (cron-only function)
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.sync_all_focus_to_unified_sales()',
    'EXECUTE'
  ),
  'authenticated role cannot EXECUTE sync_all_focus_to_unified_sales'
);

-- Test 4: authenticated CAN execute the public overload
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.sync_focus_to_unified_sales(uuid)',
    'EXECUTE'
  ),
  'authenticated role CAN EXECUTE sync_focus_to_unified_sales(uuid)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Run sync as owner to populate offset rows
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-f0c000000101"}';
SELECT sync_focus_to_unified_sales('00000000-0000-0000-0000-f0c000000111'::uuid);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tests 5-6: Offset row IDs include revenue_center slug (Fix 3)
--
-- revenue_center = 'Drive-Through' → focus_slug → 'drive-through'
-- expected tax  external_item_id = 'focus-SH999-20260602_drive-through_tax'
-- expected tip  external_item_id = 'focus-SH999-20260602_drive-through_tip'
-- ─────────────────────────────────────────────────────────────────────────────

-- Test 5: tax offset row external_item_id contains revenue_center slug
SELECT ok(
  (SELECT COUNT(*) > 0 FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000111'
     AND pos_system = 'focus'
     AND item_type = 'tax'
     AND external_item_id LIKE '%drive-through%tax'),
  'Tax offset external_item_id contains revenue_center slug (drive-through)'
);

-- Test 6: tip offset row external_item_id contains revenue_center slug
SELECT ok(
  (SELECT COUNT(*) > 0 FROM public.unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000111'
     AND pos_system = 'focus'
     AND item_type = 'tip'
     AND external_item_id LIKE '%drive-through%tip'),
  'Tip offset external_item_id contains revenue_center slug (drive-through)'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Test 7: sync_all_focus_to_unified_sales advances last_sync_time (Fix 2)
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '';

-- Capture last_sync_time before calling sync_all
DO $$
DECLARE
  v_before timestamptz;
  v_after  timestamptz;
BEGIN
  SELECT last_sync_time INTO v_before
  FROM public.focus_connections
  WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000111';

  -- Run sync_all (operates on last 2 UTC days; daily report is for 2026-06-02
  -- so may not overlap — what matters is last_sync_time is updated regardless)
  PERFORM * FROM public.sync_all_focus_to_unified_sales();

  SELECT last_sync_time INTO v_after
  FROM public.focus_connections
  WHERE restaurant_id = '00000000-0000-0000-0000-f0c000000111';

  IF v_after IS NULL OR v_after <= v_before THEN
    RAISE EXCEPTION 'last_sync_time was not advanced by sync_all (before=%, after=%)',
      v_before, v_after;
  END IF;
END;
$$;

SELECT ok(TRUE, 'sync_all_focus_to_unified_sales advances last_sync_time (round-robin fix)');

SELECT * FROM finish();
ROLLBACK;
