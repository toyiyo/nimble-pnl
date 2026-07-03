-- Tests for Focus POS backfill reliability migration
-- Migration: 20260703120000_focus_backfill_reliability.sql
--
-- Test plan (10 tests):
--  1  focus-transactions-unified-sales-sync now runs every 5 minutes (was 6 h)
--  2  focus-backfill-sync cron uses a hardcoded URL (no current_setting GUC)
--  3  focus-bulk-sync cron uses a hardcoded URL (no current_setting GUC)
--  4  sync_all_focus_transactions_to_unified_sales() still exists after CREATE OR REPLACE
--  5  _focus_parse_local_time parses the real datafeed format (MM/DD/YYYY HH24:MI:SS)
--  6  _focus_parse_local_time parses the ISO variant (YYYY-MM-DDTHH24:MI:SS)
--  7  impl runs without error when a check has a malformed opened_at_local
--  8  sale rows get sale_time from the check's TimeOpened
--  9  tip offset rows get the same sale_time
-- 10  malformed timestamps degrade to NULL sale_time (row still synced)

BEGIN;
SELECT plan(10);

-- Test 1: the transaction→unified_sales aggregation cron is now every 5 minutes,
-- so backfilled days reach P&L within minutes (in-database, no edge CPU limit).
SELECT is(
  (SELECT schedule FROM cron.job WHERE jobname = 'focus-transactions-unified-sales-sync'),
  '*/5 * * * *',
  'focus-transactions-unified-sales-sync runs every 5 minutes'
);

-- Test 2: the backfill cron must be hardcoded (the app.settings.supabase_url GUC
-- cannot be set on Supabase, so a current_setting()-based URL silently no-ops).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-backfill-sync') NOT ILIKE '%current_setting%',
  'focus-backfill-sync cron uses a hardcoded URL (no current_setting GUC dependency)'
);

-- Test 3: focus-bulk-sync must be hardcoded too (same GUC no-op failure mode).
SELECT ok(
  (SELECT command FROM cron.job WHERE jobname = 'focus-bulk-sync') NOT ILIKE '%current_setting%',
  'focus-bulk-sync cron uses a hardcoded URL (no current_setting GUC dependency)'
);

-- Test 4: the aggregation function is intact after CREATE OR REPLACE.
SELECT has_function(
  'public',
  'sync_all_focus_transactions_to_unified_sales',
  'sync_all_focus_transactions_to_unified_sales() exists'
);

-- Test 5/6: the tolerant local-time parser.
SELECT is(
  public._focus_parse_local_time('06/29/2026 12:26:06'),
  '12:26:06'::time,
  '_focus_parse_local_time parses the real datafeed format (MM/DD/YYYY HH24:MI:SS)'
);

SELECT is(
  public._focus_parse_local_time('2026-06-15T10:00:00'),
  '10:00:00'::time,
  '_focus_parse_local_time parses the ISO T-separated variant'
);

-- ─────────────────────────────────────────────────────────────────────
-- Functional: sale_time flows from focus_orders → unified_sales
-- ─────────────────────────────────────────────────────────────────────
SET LOCAL role TO postgres;
ALTER TABLE public.restaurants        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_connections  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_orders       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_order_items  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_payments     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unified_sales      DISABLE ROW LEVEL SECURITY;

INSERT INTO public.restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-f0c200000011', 'Focus Time Creamery', '2 Timestamp Way', '555-0049');

INSERT INTO public.focus_connections (
  id, restaurant_id, store_id,
  api_key, api_secret_encrypted, environment,
  is_active, connection_status, initial_sync_done, last_sync_time
) VALUES (
  '00000000-0000-0000-0000-f0c200000021',
  '00000000-0000-0000-0000-f0c200000011',
  'TIME-TEST-STORE',
  'test-api-key', 'enc-placeholder', 'production',
  true, 'connected', false, now()
);

-- Check A: real datafeed timestamp format; one priced item + one tipped payment.
-- Check B: malformed opened_at_local + NULL closed_at_local; one priced item.
INSERT INTO public.focus_orders (
  id, restaurant_id, business_date, focus_check_id,
  opened_at_local, closed_at_local,
  order_type_id, revenue_center_id, guests, total, discount_total, taxable_sales
) VALUES
  ('00000000-0000-0000-0000-f0c200000031',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-06-20', '7',
   '06/20/2026 14:33:07', '06/20/2026 14:35:00',
   '1', 'RC1', 1, 5.50, 0.00, 5.00),
  ('00000000-0000-0000-0000-f0c200000032',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-06-21', '8',
   'not-a-timestamp', NULL,
   '1', 'RC1', 1, 3.00, 0.00, 3.00);

INSERT INTO public.focus_order_items (
  id, restaurant_id, business_date, focus_check_id, item_key,
  record_number, item_code, name, report_group_id,
  price, parent_key, is_modifier, discount_amount
) VALUES
  ('00000000-0000-0000-0000-f0c200000041',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-06-20', '7', 'IK-T1',
   'RN-001', 'IC-001', 'Sundae', 'Ice Cream',
   4.50, NULL, false, 0.00),
  ('00000000-0000-0000-0000-f0c200000042',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-06-21', '8', 'IK-T2',
   'RN-001', 'IC-002', 'Cone', 'Ice Cream',
   3.00, NULL, false, 0.00);

INSERT INTO public.focus_payments (
  id, restaurant_id, business_date, focus_check_id, payment_key,
  payment_id, name, amount, tip, card_last4
) VALUES
  ('00000000-0000-0000-0000-f0c200000051',
   '00000000-0000-0000-0000-f0c200000011',
   '2026-06-20', '7', 'PK-T1',
   'P-1', 'Visa', 5.50, 1.00, '1234');

-- Test 7: the sync survives the malformed timestamp (degrades, never raises).
SELECT lives_ok(
  $q$SELECT public._sync_focus_transactions_to_unified_sales_impl(
       '00000000-0000-0000-0000-f0c200000011'::uuid, NULL, NULL)$q$,
  'impl runs without error when a check has a malformed opened_at_local'
);

-- Test 8: sale row carries the check''s TimeOpened as sale_time.
SELECT is(
  (SELECT us.sale_time FROM public.unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-f0c200000011'
     AND us.pos_system = 'focus' AND us.item_type = 'sale'
     AND us.sale_date = '2026-06-20'),
  '14:33:07'::time,
  'sale rows get sale_time from the check TimeOpened'
);

-- Test 9: tip offset row carries the same sale_time.
SELECT is(
  (SELECT us.sale_time FROM public.unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-f0c200000011'
     AND us.pos_system = 'focus' AND us.item_type = 'tip'
     AND us.sale_date = '2026-06-20'),
  '14:33:07'::time,
  'tip offset rows get the same sale_time'
);

-- Test 10: malformed timestamp → row synced with NULL sale_time (not dropped).
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.unified_sales us
    WHERE us.restaurant_id = '00000000-0000-0000-0000-f0c200000011'
      AND us.pos_system = 'focus' AND us.item_type = 'sale'
      AND us.sale_date = '2026-06-21'
      AND us.sale_time IS NULL
  ),
  'malformed timestamps degrade to NULL sale_time; the row is still synced'
);

SELECT * FROM finish();
ROLLBACK;
