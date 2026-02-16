# Toast Incremental Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch the 5-minute cron from full-table re-sync to incremental date-range sync, add a missing index, and ensure batch aggregation covers all affected dates.

**Architecture:** The cron function `sync_all_toast_to_unified_sales()` currently calls the single-arg overload (processes ALL orders). We redefine it to read each connection's `last_sync_time` and call the date-range overload instead. A new index on `toast_payments(restaurant_id, payment_date)` speeds up the date-filtered joins. The single-arg overload remains for manual full re-sync.

**Tech Stack:** PostgreSQL, pgTAP, pg_cron

**Design doc:** `docs/plans/2026-02-16-toast-incremental-sync-design.md`

---

### Task 1: Write the pgTAP test file

**Files:**
- Create: `supabase/tests/31_toast_incremental_sync.sql`

**Context:** This test verifies the new incremental sync behavior. It needs to create a `toast_connections` row (the old function never read this table), insert test orders on two different dates, then verify that:
1. The cron function uses date-range scoping (only syncs recent orders)
2. The `toast_payments` index exists
3. Batch aggregation runs for affected dates

The test reuses the same setup pattern from `supabase/tests/30_toast_sync_timeout_fix.sql` (user, restaurant, RLS disable, JWT claims).

**Step 1: Write the test file**

```sql
-- pgTAP tests for Toast incremental sync
-- Tests migration: 20260216HHMMSS_toast_incremental_sync.sql
--
-- Verifies that sync_all_toast_to_unified_sales() uses date-range overload
-- with last_sync_time, and that toast_payments index exists.

BEGIN;
SELECT plan(9);

-- ============================================================
-- Setup
-- ============================================================
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Auth context for batch categorization
SELECT set_config(
  'request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-310000000001", "role": "authenticated"}',
  true
);

-- Test user
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES ('00000000-0000-0000-0000-310000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'incr-sync-owner@test.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

-- Test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-310000000011', 'Incremental Sync Test Restaurant', '200 Incr Ave', '555-3100')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-310000000001', '00000000-0000-0000-0000-310000000011', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Active toast connection with last_sync_time = 1 hour ago
INSERT INTO toast_connections (id, restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active, last_sync_time, connection_status, initial_sync_done)
VALUES (
  '00000000-0000-0000-0000-310000000099',
  '00000000-0000-0000-0000-310000000011',
  'test-client-id',
  'encrypted-secret',
  'incr-rest-guid',
  true,
  NOW() - INTERVAL '1 hour',
  'connected',
  true
)
ON CONFLICT (id) DO UPDATE SET last_sync_time = EXCLUDED.last_sync_time, is_active = EXCLUDED.is_active;

-- OLD order: 30 days ago (outside the 25-hour window)
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-310000000021', 'incr-old-order', '00000000-0000-0000-0000-310000000011', 'incr-rest-guid', CURRENT_DATE - 30, '10:00:00', 25.00, 2.00, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('incr-old-item', 'incr-old-order', '00000000-0000-0000-0000-310000000011', 'Old Pasta', 1, 25.00, 25.00, false, 0, 'Entrees', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET unit_price = EXCLUDED.unit_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('incr-old-pay', 'incr-old-order', '00000000-0000-0000-0000-310000000011', CURRENT_DATE - 30, 'CREDIT', 25.00, 3.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- RECENT order: today (inside the 25-hour window)
INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-310000000022', 'incr-new-order', '00000000-0000-0000-0000-310000000011', 'incr-rest-guid', CURRENT_DATE, '14:00:00', 18.00, 1.50, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('incr-new-item', 'incr-new-order', '00000000-0000-0000-0000-310000000011', 'Fresh Salad', 1, 18.00, 18.00, false, 0, 'Salads', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET unit_price = EXCLUDED.unit_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('incr-new-pay', 'incr-new-order', '00000000-0000-0000-0000-310000000011', CURRENT_DATE, 'CREDIT', 18.00, 2.00, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- ============================================================
-- TEST 1: sync_all completes without error
-- ============================================================
SELECT lives_ok(
  $q$ SELECT * FROM sync_all_toast_to_unified_sales() $q$,
  'sync_all_toast_to_unified_sales completes without error'
);

-- TEST 2: Only RECENT order was synced (date-range scoping works)
-- The old order (30 days ago) is outside the 25-hour window
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-new-order'),
  3,
  'Recent order synced: 3 rows (sale + tax + tip)'
);

-- TEST 3: Old order was NOT synced (outside 25h window)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-old-order'),
  0,
  'Old order (30 days ago) was NOT synced by incremental cron'
);

-- TEST 4: Full sync still processes old orders (single-arg overload)
-- Clean up first
DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-310000000011';

SELECT lives_ok(
  $q$ SELECT sync_toast_to_unified_sales('00000000-0000-0000-0000-310000000011'::UUID) $q$,
  'Single-arg full sync completes without error'
);

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'
     AND external_order_id = 'incr-old-order'),
  3,
  'Full sync processes old order: 3 rows (sale + tax + tip)'
);

-- TEST 5: NULL last_sync_time falls back to 90-day window
-- Clean up
DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-310000000011';
UPDATE toast_connections SET last_sync_time = NULL WHERE id = '00000000-0000-0000-0000-310000000099';

SELECT lives_ok(
  $q$ SELECT * FROM sync_all_toast_to_unified_sales() $q$,
  'sync_all handles NULL last_sync_time without error'
);

-- Both orders should be synced (both within 90-day fallback)
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM unified_sales
   WHERE restaurant_id = '00000000-0000-0000-0000-310000000011'),
  6,
  'NULL last_sync_time: both orders synced (6 rows total, 90-day fallback)'
);

-- TEST 6: toast_payments index exists
SELECT has_index(
  'public',
  'toast_payments',
  'idx_toast_payments_restaurant_date',
  'toast_payments(restaurant_id, payment_date) index exists'
);

SELECT * FROM finish();
ROLLBACK;
```

**Step 2: Run the test to verify it fails**

Run: `npm run test:db`
Expected: FAIL — `sync_all_toast_to_unified_sales()` still calls single-arg (syncs all orders), index doesn't exist yet.

**Step 3: Commit the failing test**

```bash
git add supabase/tests/31_toast_incremental_sync.sql
git commit -m "test: add pgTAP tests for toast incremental sync (red)"
```

---

### Task 2: Write the migration

**Files:**
- Create: `supabase/migrations/20260216120000_toast_incremental_sync.sql`

**Context:** This migration does three things:
1. Adds the `idx_toast_payments_restaurant_date` index
2. Redefines `sync_all_toast_to_unified_sales()` to use date-range overload with `last_sync_time - 25h`
3. Keeps existing cron schedule (no change — same function name, just new body)

The function must handle `NULL` `last_sync_time` by falling back to 90 days (matching initial sync window). It must preserve the `SECURITY DEFINER` and `SET search_path = public` pattern from the timeout fix migration.

**Step 1: Write the migration**

```sql
-- Toast Incremental Sync
--
-- Switches the 5-minute cron from full-table re-sync to incremental
-- date-range sync based on each connection's last_sync_time.
-- Adds missing toast_payments index for date-range queries.
--
-- Depends on: 20260215200000_fix_toast_sync_timeout.sql (GUC bypass, date-range overload)

-- ============================================================
-- Part 1: Add missing index on toast_payments
-- ============================================================
-- The date-range overload filters by payment_date. Without this index,
-- every sync does a sequential scan on the payments table.
CREATE INDEX IF NOT EXISTS idx_toast_payments_restaurant_date
  ON public.toast_payments (restaurant_id, payment_date);

-- ============================================================
-- Part 2: Redefine sync_all to use date-range overload
-- ============================================================
-- Previously called the single-arg overload (re-processes ALL orders).
-- Now reads last_sync_time from toast_connections and calls the
-- date-range overload with a 25-hour buffer.
--
-- Why 25 hours? Toast data can be corrected within 24 hours.
-- The 1-hour buffer prevents boundary misses at midnight.
--
-- NULL last_sync_time falls back to 90 days (initial sync window).
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
BEGIN
  FOR v_connection IN
    SELECT tc.restaurant_id, tc.last_sync_time
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Compute start date from last_sync_time with 25-hour buffer
      -- Fall back to 90 days if NULL (new connection, initial sync not done)
      v_start_date := COALESCE(
        (v_connection.last_sync_time - INTERVAL '25 hours')::DATE,
        (CURRENT_DATE - INTERVAL '90 days')::DATE
      );

      -- Use date-range overload (only processes orders in window)
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        v_start_date,
        CURRENT_DATE
      ) INTO v_synced;

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
    END;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION sync_all_toast_to_unified_sales IS
  'Incrementally syncs Toast orders to unified_sales for all active connections. '
  'Uses each connection''s last_sync_time with 25-hour buffer. '
  'Falls back to 90-day window for connections without last_sync_time. '
  'Runs every 5 minutes via cron. '
  'For full re-sync, call sync_toast_to_unified_sales(restaurant_id) directly.';
```

**Step 2: Apply the migration**

Run: `npm run db:reset`
Expected: Clean reset, all migrations apply including the new one.

**Step 3: Run the tests**

Run: `npm run test:db`
Expected: All 9 tests in `31_toast_incremental_sync.sql` PASS. All 12 tests in `30_toast_sync_timeout_fix.sql` still PASS.

**Step 4: Commit**

```bash
git add supabase/migrations/20260216120000_toast_incremental_sync.sql
git commit -m "perf: switch toast cron to incremental date-range sync + add payments index"
```

---

### Task 3: Verify and cherry-pick to PR branch

**Context:** The worktree is on branch `fix/toast-sync-timeout`. The PR branch is `fix/toast-sync-timeout-clean`. After confirming tests pass, cherry-pick the commits to the PR branch and push.

**Step 1: Run full test suite**

Run: `npm run test:db`
Expected: All pgTAP tests pass (both files 30 and 31).

**Step 2: Cherry-pick to PR branch**

```bash
# Get the commit SHAs
git log --oneline -3

# From the main repo directory:
cd /Users/josedelgado/Documents/GitHub/nimble-pnl
git checkout fix/toast-sync-timeout-clean
git cherry-pick <test-commit-sha> <migration-commit-sha>
git push origin fix/toast-sync-timeout-clean
```

**Step 3: Verify PR branch**

Run: `git log --oneline -5 fix/toast-sync-timeout-clean`
Expected: Both new commits appear after the CodeRabbit fix commit.
