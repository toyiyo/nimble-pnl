# Toast Rollup Watermark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip a restaurant's 5-minute Toast rollup when no Toast source data changed since the last successful rollup.

**Architecture:** A `rollup_source_watermark` column on `toast_connections` stores the newest source marker at the last successful rollup. The cron wrapper `sync_all_toast_to_unified_sales()` computes the current marker with three indexed `max(synced_at)` probes plus `last_sync_time`, and skips the restaurant when the marker did not move. Design: `docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md`.

**Tech Stack:** Postgres (plpgsql, pgTAP), Supabase migrations. No frontend change.

## Global Constraints

- Write all prose in ASD-STE100 (per CLAUDE.md).
- Stage explicit paths only. Always use `git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark`. Never `git add -A`.
- The pgTAP runner is `npm run test:db`. Do not use `supabase test db` (memory/lessons.md 2026-08-09).
- Apply migrations locally with `npm run db:reset`. Confirm the reset reached the new files: `npx supabase migration list` must show them (memory/lessons.md 2026-08-09: a reset once stopped 30 migrations early).
- One `CREATE INDEX CONCURRENTLY` statement per migration file. No other statement in those files.
- Local Supabase must run: `npm run db:start` once before the first reset.
- E2E gate note for Phase 8: **Justified exception** — the change is inside a pg_cron SQL function with no user-facing surface. pgTAP covers the seam. No Playwright spec applies.

---

### Task 1: Schema migrations (column + three indexes) with pgTAP schema tests

**Files:**
- Create: `supabase/migrations/20260814140000_toast_rollup_watermark_column.sql`
- Create: `supabase/migrations/20260814140100_idx_toast_orders_synced_at.sql`
- Create: `supabase/migrations/20260814140200_idx_toast_order_items_synced_at.sql`
- Create: `supabase/migrations/20260814140300_idx_toast_payments_synced_at.sql`
- Create: `supabase/tests/64_toast_rollup_watermark.sql` (schema part; Task 2 extends it)

**Interfaces:**
- Consumes: existing tables `toast_connections`, `toast_orders`, `toast_order_items`, `toast_payments`.
- Produces: column `public.toast_connections.rollup_source_watermark timestamptz`; indexes `idx_toast_orders_restaurant_synced_at`, `idx_toast_order_items_restaurant_synced_at`, `idx_toast_payments_restaurant_synced_at`. Task 2 reads the column and relies on the indexes.

- [ ] **Step 1: Write the failing schema tests**

Create `supabase/tests/64_toast_rollup_watermark.sql`:

```sql
-- pgTAP tests for the Toast rollup source watermark.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
BEGIN;
SELECT plan(4);

SELECT has_column('public', 'toast_connections', 'rollup_source_watermark',
  'toast_connections has rollup_source_watermark');
SELECT has_index('public', 'toast_orders', 'idx_toast_orders_restaurant_synced_at',
  'toast_orders has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_order_items', 'idx_toast_order_items_restaurant_synced_at',
  'toast_order_items has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_payments', 'idx_toast_payments_restaurant_synced_at',
  'toast_payments has the (restaurant_id, synced_at) index');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the test file to check it fails**

Run: `npm run test:db 2>&1 | grep -A6 "64_toast"`
Expected: FAIL on all 4 asserts (column and indexes do not exist).

- [ ] **Step 3: Write the four migrations**

`supabase/migrations/20260814140000_toast_rollup_watermark_column.sql`:

```sql
-- Watermark for the 5-minute Toast rollup skip.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md §4.1
ALTER TABLE public.toast_connections
  ADD COLUMN IF NOT EXISTS rollup_source_watermark timestamptz;

COMMENT ON COLUMN public.toast_connections.rollup_source_watermark IS
  'Newest Toast source marker at the last successful rollup: GREATEST of '
  'max(synced_at) over toast_orders, toast_order_items, toast_payments, and '
  'last_sync_time. NULL = never rolled up under this scheme. '
  'sync_all_toast_to_unified_sales() skips the restaurant when this value '
  'did not move.';
```

`supabase/migrations/20260814140100_idx_toast_orders_synced_at.sql`:

```sql
-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file: the CLI
-- pipelines a file's statements, and CONCURRENTLY cannot run inside a
-- transaction (prior art: 20260524120100_add_file_hash_indexes.sql).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_orders_restaurant_synced_at
  ON public.toast_orders (restaurant_id, synced_at DESC);
```

`supabase/migrations/20260814140200_idx_toast_order_items_synced_at.sql`:

```sql
-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file (see
-- 20260814140100).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_order_items_restaurant_synced_at
  ON public.toast_order_items (restaurant_id, synced_at DESC);
```

`supabase/migrations/20260814140300_idx_toast_payments_synced_at.sql`:

```sql
-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file (see
-- 20260814140100).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_payments_restaurant_synced_at
  ON public.toast_payments (restaurant_id, synced_at DESC);
```

- [ ] **Step 4: Apply migrations and check the tests pass**

Run: `npm run db:reset` then `npx supabase migration list | tail -6`
Expected: the four new files appear in the applied list.

Run: `npm run test:db 2>&1 | grep -A6 "64_toast"`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark add \
  supabase/migrations/20260814140000_toast_rollup_watermark_column.sql \
  supabase/migrations/20260814140100_idx_toast_orders_synced_at.sql \
  supabase/migrations/20260814140200_idx_toast_order_items_synced_at.sql \
  supabase/migrations/20260814140300_idx_toast_payments_synced_at.sql \
  supabase/tests/64_toast_rollup_watermark.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark commit \
  -m "feat(toast): add rollup_source_watermark column and synced_at indexes"
```

---

### Task 2: Watermark skip in the wrapper, behavior tests, and the 31-suite fixture fix

**Files:**
- Create: `supabase/migrations/20260814140400_toast_rollup_watermark_skip.sql`
- Modify: `supabase/tests/64_toast_rollup_watermark.sql` (extend to plan(18))
- Modify: `supabase/tests/31_toast_incremental_sync.sql:126-131` (fixture reset before the second wrapper call)

**Interfaces:**
- Consumes: `rollup_source_watermark` column and the three indexes from Task 1; existing `sync_toast_to_unified_sales(uuid, date, date)` and `record_pos_sync_error(text, uuid, text)`.
- Produces: the new `sync_all_toast_to_unified_sales()` body. No signature change. A skipped restaurant emits no result row.

- [ ] **Step 1: Extend the test file with failing behavior tests**

Replace the whole content of `supabase/tests/64_toast_rollup_watermark.sql` with:

```sql
-- pgTAP tests for the Toast rollup source watermark.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
-- now() is frozen inside this transaction. Future source rows use explicit
-- offsets (now() + interval 'N minutes') so each step's marker strictly
-- exceeds the stored watermark.
BEGIN;
SELECT plan(18);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- No request.jwt.claims: auth.uid() is NULL, so the inner function's
-- membership check does not apply (service-role path).

-- ── Schema (Task 1) ─────────────────────────────────────────────────────
SELECT has_column('public', 'toast_connections', 'rollup_source_watermark',
  'toast_connections has rollup_source_watermark');
SELECT has_index('public', 'toast_orders', 'idx_toast_orders_restaurant_synced_at',
  'toast_orders has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_order_items', 'idx_toast_order_items_restaurant_synced_at',
  'toast_order_items has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_payments', 'idx_toast_payments_restaurant_synced_at',
  'toast_payments has the (restaurant_id, synced_at) index');

-- ── Fixtures ────────────────────────────────────────────────────────────
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-640000000011', 'Watermark Test Restaurant', '64 Wm Ave', '555-6400')
ON CONFLICT (id) DO NOTHING;

INSERT INTO toast_connections (id, restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active, last_sync_time, connection_status, initial_sync_done)
VALUES (
  '00000000-0000-0000-0000-640000000099',
  '00000000-0000-0000-0000-640000000011',
  'wm-client-id', 'encrypted-secret', 'wm-rest-guid',
  true, NOW() - INTERVAL '1 hour', 'connected', true
);

INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-640000000021', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'wm-rest-guid', CURRENT_DATE, '12:00:00', 20.00, 1.50, '{}');

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('wm-item-1', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Burger', 1, 20.00, 20.00, false, 0, 'Entrees', '{}');

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('wm-pay-1', 'wm-order-1', '00000000-0000-0000-0000-640000000011', CURRENT_DATE, 'CREDIT', 20.00, 2.50, 'PAID', '{"refundStatus": "NONE"}');

-- ── TEST 5: first run rolls up (watermark NULL) ─────────────────────────
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'First run emits one result row for the restaurant');

-- ── TEST 6: watermark equals the captured GREATEST ──────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT GREATEST(
    (SELECT max(o.synced_at) FROM toast_orders o
      WHERE o.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT max(i.synced_at) FROM toast_order_items i
      WHERE i.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT max(p.synced_at) FROM toast_payments p
      WHERE p.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT last_sync_time FROM toast_connections
      WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'))),
  'Watermark equals GREATEST of the source markers');

-- Snapshot state for the skip assertions.
CREATE TEMP TABLE wm_snapshot AS
SELECT
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011') AS watermark,
  (SELECT COUNT(*) FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011') AS us_count,
  (SELECT max(synced_at) FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011') AS us_max_synced;

-- ── TEST 7: second run skips (no source change) ─────────────────────────
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  0,
  'Second run emits no row: the source did not move');

-- ── TEST 8: watermark unchanged after the skip ──────────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT watermark FROM wm_snapshot),
  'Skip leaves the watermark unchanged');

-- ── TEST 9: unified_sales untouched by the skip ─────────────────────────
SELECT is(
  (SELECT ROW(COUNT(*), max(synced_at))::text FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT ROW(us_count, us_max_synced)::text FROM wm_snapshot),
  'Skip leaves unified_sales untouched');

-- ── TEST 10: a new source row forces a run ──────────────────────────────
INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json, synced_at)
VALUES ('wm-item-2', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Fries', 1, 5.00, 5.00, false, 0, 'Sides', '{}', now() + INTERVAL '1 minute');

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'A new source row forces the next run');

-- ── TEST 11: watermark advanced to the new marker ───────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  now() + INTERVAL '1 minute',
  'Watermark advanced to the new source marker');

-- ── TEST 12: a last_sync_time bump alone forces a run ───────────────────
UPDATE toast_connections SET last_sync_time = now() + INTERVAL '2 minutes'
 WHERE restaurant_id = '00000000-0000-0000-0000-640000000011';

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'A last_sync_time bump alone forces the next run');

-- ── TESTS 13-15: a failed sync does not advance the watermark ───────────
CREATE FUNCTION public.wm_test_fail_insert() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.restaurant_id = '00000000-0000-0000-0000-640000000011'::uuid THEN
    RAISE EXCEPTION 'wm_test: injected failure';
  END IF;
  RETURN NEW;
END $f$;

CREATE TRIGGER wm_test_fail_insert BEFORE INSERT ON public.unified_sales
  FOR EACH ROW EXECUTE FUNCTION public.wm_test_fail_insert();

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json, synced_at)
VALUES ('wm-item-3', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Shake', 1, 6.00, 6.00, false, 0, 'Drinks', '{}', now() + INTERVAL '3 minutes');

UPDATE wm_snapshot SET watermark =
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011');

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  0,
  'A failed sync emits no result row');

SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT watermark FROM wm_snapshot),
  'A failed sync does not advance the watermark');

SELECT is(
  (SELECT connection_status FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  'error',
  'A failed sync records connection_status = error');

-- ── TESTS 16-18: the retry succeeds and advances the watermark ──────────
DROP TRIGGER wm_test_fail_insert ON public.unified_sales;
DROP FUNCTION public.wm_test_fail_insert();

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'The retry after the failure runs');

SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  now() + INTERVAL '3 minutes',
  'The retry advances the watermark to the newest marker');

SELECT is(
  (SELECT connection_status FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  'connected',
  'The retry clears connection_status back to connected');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2: Run the file to check the new tests fail**

Run: `npm run test:db 2>&1 | grep -A24 "64_toast"`
Expected: tests 6, 7, 11, and 17 FAIL. The old wrapper never writes the
watermark (6, 11, 17) and never skips (7). Every other test passes on
both bodies.

- [ ] **Step 3: Write the wrapper migration**

`supabase/migrations/20260814140400_toast_rollup_watermark_skip.sql`:

```sql
-- Skip the Toast rollup when the source did not move.
--
-- The 5-minute cron re-upserted a 25-hour unified_sales window per active
-- restaurant on every tick (~1.0 s per tick, cron.job_run_details jobid 4,
-- 2026-08-05..14). New Toast source rows arrive at most every 2 hours
-- (toast-bulk-sync) or on a manual sync. So ~23 of 24 ticks rewrote
-- identical rows. This wrapper now skips a restaurant when the newest
-- source marker did not move since the last successful rollup.
--
-- Body copied from 20260804090400_pos_sync_failure_visibility.sql:72 (the
-- latest definition; verified against production pg_get_functiondef on
-- 2026-08-14).
--
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
CREATE OR REPLACE FUNCTION sync_all_toast_to_unified_sales()
RETURNS TABLE(restaurant_id UUID, orders_synced INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_connection RECORD;
  v_synced INTEGER;
  v_start_date DATE;
  v_source_max TIMESTAMPTZ;
BEGIN
  FOR v_connection IN
    SELECT tc.restaurant_id, tc.last_sync_time, tc.rollup_source_watermark
    FROM public.toast_connections tc
    WHERE tc.is_active = true
  LOOP
    BEGIN
      -- Newest source marker for this restaurant. GREATEST ignores NULL
      -- arguments and returns NULL only when every input is NULL.
      -- last_sync_time is the fourth input: a completed edge sync that
      -- wrote zero rows still triggers exactly one rollup, which bounds
      -- edge-clock skew on synced_at to one 2-hour edge cycle.
      v_source_max := GREATEST(
        (SELECT max(o.synced_at) FROM public.toast_orders o
          WHERE o.restaurant_id = v_connection.restaurant_id),
        (SELECT max(i.synced_at) FROM public.toast_order_items i
          WHERE i.restaurant_id = v_connection.restaurant_id),
        (SELECT max(p.synced_at) FROM public.toast_payments p
          WHERE p.restaurant_id = v_connection.restaurant_id),
        v_connection.last_sync_time
      );

      -- Skip when nothing moved since the last successful rollup.
      -- v_source_max is captured BEFORE the sync; the success path stores
      -- this captured value, never a fresh max. A row written during the
      -- sync carries a later marker, so the next tick picks it up.
      IF v_source_max IS NOT DISTINCT FROM v_connection.rollup_source_watermark THEN
        CONTINUE;
      END IF;

      -- Compute start date from last_sync_time with 25-hour buffer
      -- Fall back to 90 days if NULL (new connection, initial sync not done)
      v_start_date := COALESCE(
        (v_connection.last_sync_time - INTERVAL '25 hours')::DATE,
        (CURRENT_DATE - INTERVAL '90 days')::DATE
      );

      -- Use date-range overload (only processes orders in window)
      -- CURRENT_DATE is evaluated in server timezone (UTC on Supabase).
      -- Since UTC is ahead of all US timezones, CURRENT_DATE always
      -- covers the restaurant's local "today."
      SELECT sync_toast_to_unified_sales(
        v_connection.restaurant_id,
        v_start_date,
        CURRENT_DATE
      ) INTO v_synced;

      -- One merged write per successful sync: advance the watermark and
      -- clear a stale failure. The old separate clear-UPDATE carried a
      -- WHERE guard against 5-minute churn; the skip above removes that
      -- churn at the loop level, so the guard is gone with it.
      UPDATE public.toast_connections tc2
         SET rollup_source_watermark = v_source_max,
             connection_status = 'connected',
             last_error = NULL,
             last_error_at = NULL
       WHERE tc2.restaurant_id = v_connection.restaurant_id;

      restaurant_id := v_connection.restaurant_id;
      orders_synced := v_synced;
      RETURN NEXT;
    EXCEPTION
      -- WHEN OTHERS does NOT catch query_canceled (57014); name it explicitly
      -- so a timed-out restaurant is skipped instead of aborting the whole run.
      -- Both arms leave rollup_source_watermark unchanged: the next tick
      -- sees the same moved marker and retries.
      WHEN query_canceled THEN
        RAISE WARNING 'sync_all_toast_to_unified_sales: timed out for restaurant %: %',
          v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
      WHEN OTHERS THEN
        RAISE WARNING 'Failed to sync restaurant %: %', v_connection.restaurant_id, SQLERRM;
        PERFORM public.record_pos_sync_error('toast', v_connection.restaurant_id, SQLERRM);
    END;
  END LOOP;

  RETURN;
END;
$$;

COMMENT ON FUNCTION sync_all_toast_to_unified_sales() IS
  'Runs the date-range Toast rollup for every active connection. Skips a '
  'restaurant when GREATEST(max(synced_at) over the three Toast source '
  'tables, last_sync_time) did not move past rollup_source_watermark. '
  'Advances the watermark only after a successful sync.';

-- CREATE OR REPLACE keeps the current ACL, but a replay against a fresh
-- database creates the function with the default public-schema EXECUTE
-- grants. Restate the grants (pattern:
-- 20260804091000_standing_categorization_sweep.sql:201).
REVOKE EXECUTE ON FUNCTION sync_all_toast_to_unified_sales()
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION sync_all_toast_to_unified_sales() TO service_role;
```

- [ ] **Step 4: Fix the 31-suite fixture**

In `supabase/tests/31_toast_incremental_sync.sql`, directly before the
second `sync_all_toast_to_unified_sales()` call (test 5, after the
`UPDATE toast_connections SET last_sync_time = NULL ...` statement around
line 128), insert:

```sql
-- Watermark skip (2026-08-14 design): the wrapper skips when no source
-- change happened. This test re-runs the wrapper after only deleting
-- unified_sales rows, so reset the watermark to force a real run.
UPDATE toast_connections SET rollup_source_watermark = NULL
 WHERE restaurant_id = '00000000-0000-0000-0000-310000000011';
```

- [ ] **Step 5: Apply and check all pgTAP suites pass**

Run: `npm run db:reset` then `npx supabase migration list | tail -3`
Expected: `20260814140400` appears.

Run: `npm run test:db`
Expected: all suites PASS, including `64_toast_rollup_watermark.sql` (18/18)
and `31_toast_incremental_sync.sql` (8/8).

- [ ] **Step 6: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark add \
  supabase/migrations/20260814140400_toast_rollup_watermark_skip.sql \
  supabase/tests/64_toast_rollup_watermark.sql \
  supabase/tests/31_toast_incremental_sync.sql
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark commit \
  -m "feat(toast): skip the 5-minute rollup when the source did not move"
```

---

### Task 3: Regenerate types and update the docs

**Files:**
- Modify: `src/types/supabase.ts` (generated)
- Modify: `CLAUDE.md` (Toast sync-pattern bullet)

**Interfaces:**
- Consumes: the applied local migrations from Tasks 1-2.
- Produces: generated types that include `rollup_source_watermark`; a CLAUDE.md line that documents the skip.

- [ ] **Step 1: Regenerate the types**

Follow `.claude/commands/sync-types.md`: call the local
`mcp__supabase__generate_typescript_types` tool and overwrite
`src/types/supabase.ts` with the output. If the MCP tool is unavailable,
run: `npx supabase gen types typescript --local > src/types/supabase.ts`.

Check: `grep -n "rollup_source_watermark" src/types/supabase.ts`
Expected: at least one match (Row/Insert/Update types of `toast_connections`).

- [ ] **Step 2: Update CLAUDE.md**

In the Toast section, change the line:

```text
- **unified_sales sync**: For large imports, defer to cron job (`sync_all_toast_to_unified_sales()`, pg_cron jobid 4, every 5 minutes) to avoid timeouts
```

to:

```text
- **unified_sales sync**: For large imports, defer to cron job (`sync_all_toast_to_unified_sales()`, pg_cron jobid 4, every 5 minutes) to avoid timeouts. The cron skips a restaurant when `rollup_source_watermark` on `toast_connections` shows no source change since the last successful rollup.
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark add \
  src/types/supabase.ts CLAUDE.md
git -C /Users/josedelgado/Documents/GitHub/nimble-pnl/.claude/worktrees/toast-rollup-watermark commit \
  -m "chore(toast): regenerate types and document the rollup skip"
```
