# Design: Skip the Toast rollup when the source did not move

Date: 2026-08-14
Status: Approved approach (user chat, 2026-08-14). Details in this doc.
Author: Claude (session: Toast sync performance investigation)

## 1. Problem

`sync_all_toast_to_unified_sales()` runs every 5 minutes as pg_cron job
`toast-unified-sales-sync` ([20260127000000_toast_sync_improvements.sql:559](../../../supabase/migrations/20260127000000_toast_sync_improvements.sql)).
Each run re-upserts a 25-hour window of `unified_sales` rows per active
restaurant ([20260804090400_pos_sync_failure_visibility.sql:81-93](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql)).

New Toast source data arrives from two edge functions only:

- `toast-bulk-sync`, on a 2-hour cron. It writes rows through
  `toastOrderProcessor.ts` and stamps `synced_at` on every upsert
  ([toastOrderProcessor.ts:135](../../../supabase/functions/_shared/toastOrderProcessor.ts),
  [:169](../../../supabase/functions/_shared/toastOrderProcessor.ts),
  [:200](../../../supabase/functions/_shared/toastOrderProcessor.ts)).
  It bumps `toast_connections.last_sync_time` after each restaurant
  ([toast-bulk-sync/index.ts:241](../../../supabase/functions/toast-bulk-sync/index.ts)).
- `toast-sync-data`, user-triggered. Same processor, same stamps. It also
  bumps `last_sync_time`, but only when the sync is not a custom range
  (`if (!isCustomRange)`,
  [toast-sync-data/index.ts:545-547](../../../supabase/functions/toast-sync-data/index.ts)).
  A custom-range manual sync still moves `synced_at` on the source rows,
  so the watermark still moves.

So about 23 of every 24 cron ticks rewrite identical data. Production
measurement (cron.job_run_details, jobid 4, 2026-08-05 to 2026-08-14):
average 1.0 s per tick, 288 ticks per day, zero failures. The work is
harmless but redundant.

## 2. Goal

Skip a restaurant's rollup when no Toast source data changed since the last
successful rollup. Keep every current behavior when data did change.

## 3. Approaches considered

**A. Per-connection source watermark (chosen).** Store the newest source
marker at the last successful rollup. Skip when the marker did not move.
DB-only change, no edge-function change, fails safe (an error keeps the
old watermark, so the next tick retries).

**B. Edge-driven rollup.** Call the rollup from `toast-bulk-sync` and
delete the 5-minute cron. Rejected: edge functions have a ~10 s CPU limit
(CLAUDE.md, Toast section), the rollup can exceed it, and the manual
`toast-sync-data` path would need the same change. Larger blast radius.

**C. Dirty-flag trigger on the source tables.** A per-row trigger sets a
`needs_rollup` flag on `toast_connections`. Rejected: it adds work to the
bulk-insert path (1M+ recorded inserts on `toast_order_items`), which is
the CPU-sensitive path. Three cheap index probes per tick cost less.

## 4. Design (approach A)

### 4.1 Schema

Add one column:

```sql
ALTER TABLE public.toast_connections
  ADD COLUMN IF NOT EXISTS rollup_source_watermark timestamptz;
```

`NULL` means "never rolled up under this scheme". It triggers a run
whenever any source input is non-NULL. When every source input is also
NULL, the tick skips — see invariant 3 in §4.4.

### 4.2 Indexes

The skip check computes `max(synced_at)` per restaurant on three tables.
All three tables have `synced_at timestamptz NOT NULL DEFAULT now()`
([20251116100100_toast_integration.sql:43](../../../supabase/migrations/20251116100100_toast_integration.sql),
[:64](../../../supabase/migrations/20251116100100_toast_integration.sql),
[:82](../../../supabase/migrations/20251116100100_toast_integration.sql)),
and none has an index on it. Add three, one per migration file:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_orders_restaurant_synced_at
  ON public.toast_orders (restaurant_id, synced_at DESC);
-- second file:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_order_items_restaurant_synced_at
  ON public.toast_order_items (restaurant_id, synced_at DESC);
-- third file:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_payments_restaurant_synced_at
  ON public.toast_payments (restaurant_id, synced_at DESC);
```

`CONCURRENTLY` cannot run inside a transaction, and the Supabase CLI
pipelines the statements of one migration file, so each file holds
exactly one `CREATE INDEX CONCURRENTLY` statement. Prior art:
[20260524120100_add_file_hash_indexes.sql:1-9](../../../supabase/migrations/20260524120100_add_file_hash_indexes.sql)
and
[20260524120200_add_purchase_date_index.sql](../../../supabase/migrations/20260524120200_add_purchase_date_index.sql);
same one-statement rule in
[20260804090100_idx_unified_sales_rule_candidates_v2.sql:16-19](../../../supabase/migrations/20260804090100_idx_unified_sales_rule_candidates_v2.sql).

A failed `CONCURRENTLY` build can leave an `INVALID` index under the
target name, and `IF NOT EXISTS` then skips the retry. The rollout
runbook (§7) includes the cleanup step.

### 4.3 Function change

Rewrite `sync_all_toast_to_unified_sales()` with `CREATE OR REPLACE`.
Copy the body from the latest live definition. The live production body
(read with `pg_get_functiondef` in this session) matches
[20260804090400_pos_sync_failure_visibility.sql:60-140](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql).
Insert the skip logic at the top of the per-connection block:

```sql
v_source_max := GREATEST(
  (SELECT max(o.synced_at) FROM public.toast_orders o
    WHERE o.restaurant_id = v_connection.restaurant_id),
  (SELECT max(i.synced_at) FROM public.toast_order_items i
    WHERE i.restaurant_id = v_connection.restaurant_id),
  (SELECT max(p.synced_at) FROM public.toast_payments p
    WHERE p.restaurant_id = v_connection.restaurant_id),
  v_connection.last_sync_time
);

IF v_source_max IS NOT DISTINCT FROM v_connection.rollup_source_watermark THEN
  CONTINUE;  -- no source change since the last successful rollup
END IF;
```

After the existing `SELECT sync_toast_to_unified_sales(...) INTO v_synced`
returns, and before `RETURN NEXT`, one merged `UPDATE` replaces the
existing guarded "clear stale failure" `UPDATE`
([20260804090400_pos_sync_failure_visibility.sql:106-111](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql)):

```sql
UPDATE public.toast_connections tc2
   SET rollup_source_watermark = v_source_max,
       connection_status = 'connected',
       last_error = NULL,
       last_error_at = NULL
 WHERE tc2.restaurant_id = v_connection.restaurant_id;
```

The old `UPDATE` carried a `WHERE` guard so a 5-minute tick did not churn
`updated_at` for nothing. The skip now removes that churn at the loop
level: a successful sync always writes the watermark, so one merged write
per successful sync replaces two.

The loop cursor gains one column: `rollup_source_watermark`. It already
selects `last_sync_time`
([20260804090400_pos_sync_failure_visibility.sql:84](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql)).

A skipped restaurant emits no result row. The cron discards the result
set, so no consumer changes.

### 4.4 Invariants

1. **Capture before sync, stamp the captured value.** `v_source_max` is
   read before the sync starts. The success path stores that captured
   value, never a fresh `max()`. A row written during the sync carries a
   later `synced_at`, so the next tick sees it.
2. **Advance only on success.** The `UPDATE` sits after the sync call
   inside the per-restaurant `BEGIN` block. Any exception jumps to the
   existing handlers
   ([20260804090400_pos_sync_failure_visibility.sql:110-124](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql))
   and skips the `UPDATE`. The next tick retries.
3. **`GREATEST` ignores NULL arguments.** It returns NULL only when all
   four inputs are NULL (empty tables and `last_sync_time IS NULL`). Then
   `NULL IS NOT DISTINCT FROM NULL` skips — correct, because there is
   nothing to roll up.
4. **`last_sync_time` is a fourth watermark input.** Every completed edge
   sync bumps it, even a run that wrote zero rows. This bounds the effect
   of any `synced_at` clock skew (the edge functions stamp with the Deno
   clock, not the DB clock) to one 2-hour edge cycle.

### 4.5 What a skipped tick does NOT skip (safety argument)

- **Rule categorization.** The standing sweep `categorization-backlog-drain`
  (pg_cron, every 5 minutes) selects restaurants by rule, not by
  connection, and runs `apply_rules_to_pos_sales_internal` independently
  ([20260804091000_standing_categorization_sweep.sql:19](../../../supabase/migrations/20260804091000_standing_categorization_sweep.sql),
  [:67-89](../../../supabase/migrations/20260804091000_standing_categorization_sweep.sql)).
  A rule edit reaches Toast rows through that path with no help from the
  Toast rollup.
- **Daily aggregation.** A skipped tick writes no `unified_sales` rows,
  so there is nothing new to aggregate from this path. The sweep
  re-aggregates the dates it touches itself.
- **Manual date-range syncs.** Users call
  `sync_toast_to_unified_sales(restaurant_id, start, end)` over PostgREST
  ([useToastSalesAdapter.tsx:70](../../../src/hooks/adapters/useToastSalesAdapter.tsx);
  overload defined in
  [20260529130000_unified_sales_sold_at.sql](../../../supabase/migrations/20260529130000_unified_sales_sold_at.sql)).
  That function is untouched.

### 4.6 Accepted trade-offs

- **Concurrent cron overlap.** Two overlapping runs can both sync the same
  restaurant and race the watermark `UPDATE`. The loser overwrites with an
  older captured value. Effect: at most one redundant rollup on the next
  tick. Accepted.
- **Toast only.** `sync_all_shift4_to_unified_sales` (mean 21 ms) and the
  focus wrappers (mean 124-796 ms) could adopt the same scheme later. Out
  of scope here; their cost is lower.
- **No forced-timeout test for `query_canceled`.** The exception arms are
  already covered by
  [pos_sync_failure_visibility.test.sql](../../../supabase/tests/pos_sync_failure_visibility.test.sql).
  The new tests cover the `WHEN OTHERS` arm with an injected trigger
  failure.

## 5. Test plan (pgTAP)

New file `supabase/tests/64_toast_rollup_watermark.sql`:

1. `has_column('toast_connections', 'rollup_source_watermark')`.
2. `has_index` for the three new indexes.
3. Fresh connection (watermark NULL) with seeded order, item, payment:
   `sync_all_toast_to_unified_sales()` emits a row for the restaurant, and
   the read-back watermark equals the computed `GREATEST(...)`.
4. Second run with no source change: no row for the restaurant, watermark
   unchanged, and `unified_sales` untouched (compare `max(synced_at)`
   before and after).
5. Insert one new order item: the next run emits a row again.
6. Bump `last_sync_time` alone: the next run emits a row (fetcher-ran
   signal).
7. Failure injection: a temporary `BEFORE INSERT` trigger on
   `unified_sales` raises for the test restaurant. The run catches the
   error, and the watermark does not advance. Drop the trigger; the next
   run succeeds and advances it.

Every assertion reads state back. No write-only assertions
(memory/lessons.md, 2026-08-11: "An UPDATE with no read-back is not a
test").

One existing suite calls `sync_all_toast_to_unified_sales()` more than
once: [31_toast_incremental_sync.sql:88,131](../../../supabase/tests/31_toast_incremental_sync.sql)
(repo-wide grep; the other Toast suites call the per-restaurant
`sync_toast_to_unified_sales` overloads, which this change does not
touch). Its test 5 deletes `unified_sales` rows and nulls
`last_sync_time` between the two calls
([31_toast_incremental_sync.sql:126-141](../../../supabase/tests/31_toast_incremental_sync.sql)).
Neither action moves `v_source_max` above the stored watermark, so the
second call would skip and the count-of-6 assertion would fail. Fix in
the same commit as migration 3: before the second call, reset
`rollup_source_watermark` to NULL for the test connection, with a comment
that names this design doc.

## 6. Migration files

1. `20260814140000_toast_rollup_watermark_column.sql` — the column.
2. `20260814140100_idx_toast_orders_synced_at.sql` — one `CONCURRENTLY`
   index, one statement, no transaction.
3. `20260814140200_idx_toast_order_items_synced_at.sql` — same, second
   index.
4. `20260814140300_idx_toast_payments_synced_at.sql` — same, third index.
5. `20260814140400_toast_rollup_watermark_skip.sql` — the wrapper
   rewrite, `COMMENT ON FUNCTION`, `COMMENT ON COLUMN`, and a restated
   `REVOKE`/`GRANT` block. `CREATE OR REPLACE` keeps the current ACL, but
   a replay against a fresh database creates the function with the
   default public-schema `EXECUTE` grants. The repo pattern restates the
   grants for exactly this case
   ([20260804091000_standing_categorization_sweep.sql:201-203](../../../supabase/migrations/20260804091000_standing_categorization_sweep.sql));
   the current grants sit at
   [20260804090400_pos_sync_failure_visibility.sql:133-135](../../../supabase/migrations/20260804090400_pos_sync_failure_visibility.sql).

Also run the `sync-types` skill so `src/integrations/supabase/types.ts`
picks up the new column.

## 7. Rollout and verification

- The change is backward-compatible. The first tick after deploy sees
  `rollup_source_watermark IS NULL` for every connection, runs one normal
  rollup per restaurant, and stamps the watermark.
- Post-deploy check (read-only):
  `SELECT avg(extract(epoch FROM end_time - start_time)) FROM cron.job_run_details WHERE jobid = 4 AND start_time > now() - interval '1 day'`.
  Expected: the average falls from ~1.0 s to well under 0.5 s, because
  most ticks reduce to three index probes per restaurant.
- If a `CONCURRENTLY` index build fails partway, the index stays under its
  name in an `INVALID` state, and `IF NOT EXISTS` skips the retry. Cleanup:
  `DROP INDEX CONCURRENTLY IF EXISTS <name>;` then run the migration
  again. Check with
  `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`.
