-- pgTAP tests for the keyset-batched public.bulk_process_historical_sales RPC
-- (see docs/superpowers/specs/2026-07-20-bulk-deduction-timeout-design.md)
--
-- GREEN against the batched 7-arg function
-- (migration 20260720120000_bulk_deduction_keyset_batching.sql), which adds
-- p_batch_size/cursor params and a tenant-authz guard on top of the
-- pre-batching 3-arg signature
-- (supabase/migrations/20251023164509_a85d8666-30e6-44bd-87f3-a5a816fc341f.sql).

BEGIN;
SELECT plan(19);

-- ---------- Fixture setup ----------
-- One restaurant, one owner (has access), one outsider (no user_restaurants
-- row for this restaurant -> must be rejected by the authz guard).
INSERT INTO auth.users (id, email, encrypted_password, aud, role) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', 'owner@bulktest.com',    '', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-0000000000a2', 'outsider@bulktest.com', '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

INSERT INTO restaurants (id, name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Bulk Batching Test Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('b0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;
-- NOTE: outsider (...a2) intentionally gets NO user_restaurants row.

-- One product (1:1 unit match with the recipe ingredient -> no conversion
-- warnings, simplest deduction path) with ample stock.
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, uom_recipe, cost_per_unit, current_stock)
VALUES ('b0000000-0000-0000-0000-000000000010', 'b0000000-0000-0000-0000-000000000001',
        'BULK-TEST-BUN', 'Test Bun', 'each', 'each', 1.00, 100000)
ON CONFLICT (id) DO UPDATE SET
  uom_purchase = EXCLUDED.uom_purchase, uom_recipe = EXCLUDED.uom_recipe,
  cost_per_unit = EXCLUDED.cost_per_unit, current_stock = EXCLUDED.current_stock;

-- One active recipe keyed to the POS item name used by every seeded sale.
INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active)
VALUES ('b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000001',
        'Test Burger', 'Test Burger', true)
ON CONFLICT (id) DO UPDATE SET pos_item_name = EXCLUDED.pos_item_name, is_active = EXCLUDED.is_active;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('b0000000-0000-0000-0000-000000000020', 'b0000000-0000-0000-0000-000000000010', 1, 'each')
ON CONFLICT DO NOTHING;

-- 7 unified_sales rows within [2026-01-01, 2026-01-10]. Rows 3 and 4 share
-- BOTH sale_date and created_at (differ only by id) to force the keyset
-- tiebreaker to be exercised right at a batch boundary (batch_size=3 splits
-- the ordered sequence [1,2,3 | 4,5,6 | 7], i.e. exactly between 3 and 4).
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date, created_at)
VALUES
  ('b0000000-0000-0000-0000-000000000101', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-1', 'Test Burger', 1, '2026-01-01', '2026-01-01 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000102', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-2', 'Test Burger', 1, '2026-01-02', '2026-01-02 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000103', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-3', 'Test Burger', 1, '2026-01-03', '2026-01-03 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000104', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-4', 'Test Burger', 1, '2026-01-03', '2026-01-03 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000105', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-5', 'Test Burger', 1, '2026-01-04', '2026-01-04 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000106', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-6', 'Test Burger', 1, '2026-01-05', '2026-01-05 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000107', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-7', 'Test Burger', 1, '2026-01-06', '2026-01-06 10:00:00+00')
ON CONFLICT (id) DO UPDATE SET sale_date = EXCLUDED.sale_date, created_at = EXCLUDED.created_at;

CREATE OR REPLACE FUNCTION test_set_user(uid UUID) RETURNS VOID
LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claim.sub', uid::text, true);
$$;

-- ============================================================
-- 1. Tenant authz: outsider (no user_restaurants row) is rejected
-- ============================================================
SELECT test_set_user('b0000000-0000-0000-0000-0000000000a2');

SELECT throws_ok(
  $sql$ SELECT public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-01-01'::date, '2026-01-10'::date,
    500, NULL, NULL, NULL
  ) $sql$,
  'P0001',
  'Not authorized for this restaurant',
  'outsider without a user_restaurants row is rejected'
);

-- Switch to the authorized owner for every remaining test.
SELECT test_set_user('b0000000-0000-0000-0000-0000000000a1');

-- ============================================================
-- 2. Batched walk with p_batch_size=3 over 7 rows: 3 calls, cursor threads
--    across the shared-timestamp boundary (rows 3/4), every row processed
--    exactly once, no skip/dup.
-- ============================================================
DO $$
DECLARE
  v_b1 jsonb;
  v_b2 jsonb;
  v_b3 jsonb;
BEGIN
  v_b1 := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-01-01'::date, '2026-01-10'::date,
    3, NULL, NULL, NULL);

  v_b2 := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-01-01'::date, '2026-01-10'::date,
    3,
    (v_b1->'next_cursor'->>'sale_date')::date,
    (v_b1->'next_cursor'->>'created_at')::timestamptz,
    (v_b1->'next_cursor'->>'id')::uuid);

  v_b3 := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-01-01'::date, '2026-01-10'::date,
    3,
    (v_b2->'next_cursor'->>'sale_date')::date,
    (v_b2->'next_cursor'->>'created_at')::timestamptz,
    (v_b2->'next_cursor'->>'id')::uuid);

  PERFORM set_config('test.b1', v_b1::text, false);
  PERFORM set_config('test.b2', v_b2::text, false);
  PERFORM set_config('test.b3', v_b3::text, false);
END $$;

SELECT is((current_setting('test.b1')::jsonb->>'batch_count')::int, 3, 'batch 1: batch_count = 3 (full batch)');
SELECT is((current_setting('test.b1')::jsonb->>'done')::boolean, false, 'batch 1: done = false (full batch, more rows remain)');
SELECT ok(current_setting('test.b1')::jsonb->'next_cursor' IS NOT NULL AND current_setting('test.b1')::jsonb->'next_cursor' <> 'null'::jsonb, 'batch 1: next_cursor is not null');

SELECT is((current_setting('test.b2')::jsonb->>'batch_count')::int, 3, 'batch 2: batch_count = 3 (crosses the tied sale_date+created_at boundary)');
SELECT is((current_setting('test.b2')::jsonb->>'done')::boolean, false, 'batch 2: done = false');

SELECT is((current_setting('test.b3')::jsonb->>'batch_count')::int, 1, 'batch 3: batch_count = 1 (final short batch)');
SELECT is((current_setting('test.b3')::jsonb->>'done')::boolean, true, 'batch 3: done = true (short batch signals completion)');
SELECT ok(current_setting('test.b3')::jsonb->'next_cursor' = 'null'::jsonb, 'batch 3: next_cursor is null once done');

SELECT is(
  (current_setting('test.b1')::jsonb->>'processed')::int
    + (current_setting('test.b2')::jsonb->>'processed')::int
    + (current_setting('test.b3')::jsonb->>'processed')::int,
  7,
  'all 7 rows processed exactly once across the 3 batches (no skip/dup at the tiebreaker boundary)'
);

SELECT is(
  (SELECT count(*)::int FROM inventory_transactions
   WHERE restaurant_id = 'b0000000-0000-0000-0000-000000000001'
     AND reference_id LIKE 'order-%'),
  7,
  'exactly 7 inventory_transactions written (one per sale, no duplicates)'
);

-- ============================================================
-- 3. Exact-multiple final batch: p_batch_size equal to the remaining row
--    count yields one extra, empty, done=true call.
-- ============================================================
-- Fresh sub-range containing exactly 2 more sales so p_batch_size=2 is an
-- exact multiple of the remaining rows.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date, created_at)
VALUES
  ('b0000000-0000-0000-0000-000000000201', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-8', 'Test Burger', 1, '2026-02-01', '2026-02-01 10:00:00+00'),
  ('b0000000-0000-0000-0000-000000000202', 'b0000000-0000-0000-0000-000000000001', 'test', 'order-9', 'Test Burger', 1, '2026-02-02', '2026-02-02 10:00:00+00')
ON CONFLICT (id) DO UPDATE SET sale_date = EXCLUDED.sale_date, created_at = EXCLUDED.created_at;

DO $$
DECLARE
  v_e1 jsonb;
  v_e2 jsonb;
BEGIN
  v_e1 := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-02-01'::date, '2026-02-28'::date,
    2, NULL, NULL, NULL);

  v_e2 := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-02-01'::date, '2026-02-28'::date,
    2,
    (v_e1->'next_cursor'->>'sale_date')::date,
    (v_e1->'next_cursor'->>'created_at')::timestamptz,
    (v_e1->'next_cursor'->>'id')::uuid);

  PERFORM set_config('test.e1', v_e1::text, false);
  PERFORM set_config('test.e2', v_e2::text, false);
END $$;

SELECT is((current_setting('test.e1')::jsonb->>'batch_count')::int, 2, 'exact-multiple: first call batch_count = 2 (all rows in one full batch)');
SELECT is((current_setting('test.e1')::jsonb->>'done')::boolean, false, 'exact-multiple: first call done = false (batch was exactly full)');
SELECT is((current_setting('test.e2')::jsonb->>'batch_count')::int, 0, 'exact-multiple: second call batch_count = 0 (empty)');
SELECT is((current_setting('test.e2')::jsonb->>'done')::boolean, true, 'exact-multiple: second call done = true');

-- ============================================================
-- 4. Idempotency: a full second pass over the already-processed range
--    reports 0 newly processed and writes no new inventory_transactions.
-- ============================================================
DO $$
DECLARE
  v_rerun jsonb;
BEGIN
  v_rerun := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-01-01'::date, '2026-01-10'::date,
    100, NULL, NULL, NULL);
  PERFORM set_config('test.rerun', v_rerun::text, false);
END $$;

SELECT is((current_setting('test.rerun')::jsonb->>'processed')::int, 0, 'idempotent re-run: 0 newly processed (all already-processed sales are skipped)');
SELECT is(
  (SELECT count(*)::int FROM inventory_transactions
   WHERE restaurant_id = 'b0000000-0000-0000-0000-000000000001'
     -- reference_id is built as `<external_order_id>_<pos_item_name>_<sale_date>`
     -- (process_unified_inventory_deduction). Scoped to just the original 7
     -- (order-1.._.. .. order-7.._..); section 3 above (exact-multiple test)
     -- legitimately wrote 2 more (order-8, order-9) in a different date
     -- range, so an unscoped 'order-%' count would be 9 here, not 7.
     AND reference_id ~ '^order-[1-7]_'),
  7,
  'idempotent re-run: inventory_transactions count for the first range unchanged (still 7)'
);

-- ============================================================
-- 5. Server-side batch-size clamp: the function is directly RPC-callable, so a
--    caller-supplied p_batch_size larger than the safe max (500) must be
--    clamped (else, combined with statement_timeout=120s, it enables a heavy
--    single-statement DoS). Seed 501 sales so a genuine 500 clamp is
--    observable as batch_count=500 / done=false rather than "all in one batch".
-- ============================================================
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date, created_at)
SELECT
  ('b0000000-0000-0000-0000-' || lpad((300000 + g)::text, 12, '0'))::uuid,
  'b0000000-0000-0000-0000-000000000001', 'test', 'clamp-' || g, 'Test Burger', 1,
  '2026-03-01'::date, '2026-03-01 10:00:00+00'::timestamptz + (g || ' seconds')::interval
FROM generate_series(1, 501) g
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE v_clamp jsonb;
BEGIN
  v_clamp := public.bulk_process_historical_sales(
    'b0000000-0000-0000-0000-000000000001'::uuid, '2026-03-01'::date, '2026-03-31'::date,
    100000, NULL, NULL, NULL);
  PERFORM set_config('test.clamp', v_clamp::text, false);
END $$;

SELECT is((current_setting('test.clamp')::jsonb->>'batch_count')::int, 500,
  'p_batch_size is clamped to 500 even when the caller requests 100000');
SELECT is((current_setting('test.clamp')::jsonb->>'done')::boolean, false,
  'clamped 500-row batch over 501 rows reports done=false (more remain)');

SELECT * FROM finish();
ROLLBACK;
