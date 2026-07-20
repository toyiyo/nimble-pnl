# Design: Fix "statement timeout" on bulk inventory deductions

**Date:** 2026-07-20
**Branch:** `fix/bulk-deduction-timeout`
**Type:** Bug fix (performance / architecture)

## Problem

Clicking **Bulk Process Sales** on the Recipes page (after creating a recipe)
fails with:

```
canceling statement due to statement timeout
```

### Root cause (from systematic-debugging investigation)

`bulk_process_historical_sales(p_restaurant_id, p_start_date, p_end_date)`
(latest def: `supabase/migrations/20251023164509_*.sql`) runs an **unbounded
`FOR` loop over every `unified_sales` row in the date range inside a single RPC
statement**, calling `process_unified_inventory_deduction` per sale (which itself
loops per ingredient with `UPDATE` + redundant `SELECT` + `INSERT`).

That whole loop executes as **one statement** invoked via `supabase.rpc(...)`.
The function's only `SET` clause is `search_path` — unlike every other heavy
function in this repo, it **never `SET statement_timeout`**, so it inherits the
~8s Supabase `authenticated`-role default. Evidence:

| Fact | Evidence |
|---|---|
| One statement, default timeout | Function sets only `search_path`; 18+ sibling functions `SET statement_timeout = '120s'`. |
| Large, unbounded workload | `unified_sales` = **163,198 rows** in prod; loop has no `LIMIT`/pagination/commit-between-rows. |
| Costly per-row work | Per sale: dedup `EXISTS` on `inventory_transactions` (`reference_id` **not indexed**) + recipe lookup `(pos_item_name = X OR name = X)` (only `name` indexed). Per ingredient: `UPDATE products` + redundant `SELECT` + `INSERT`. |

Because a user backfilling a newly created recipe naturally picks a **wide date
range** (months), the loop iterates tens of thousands of sales and blows the
timeout.

### Constraint (user)

We **cannot** shrink the work by scoping to just the new recipe: other recipes
may also be un-backfilled, so the bulk process must still walk **all** sales in
the range.

## Approach: client-driven keyset batching (approved)

Make each RPC call process a **bounded batch** so it can never hit the timeout;
the hook loops until done, showing live progress. Safe to resume because the
existing `reference_id` dedup makes each sale idempotent.

### 1. RPC — bounded, resumable batch

Replace the 3-arg function with a batched version (extra params defaulted so a
plain 3-arg call still resolves; drop the old exact signature first to avoid
PostgREST overload ambiguity):

```sql
DROP FUNCTION IF EXISTS public.bulk_process_historical_sales(uuid, date, date);

CREATE OR REPLACE FUNCTION public.bulk_process_historical_sales(
    p_restaurant_id     uuid,
    p_start_date        date,
    p_end_date          date,
    p_batch_size        integer     DEFAULT 500,
    p_after_sale_date   date        DEFAULT NULL,
    p_after_created_at  timestamptz DEFAULT NULL,
    p_after_id          uuid        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'          -- escape the ~8s API default (per-batch headroom)
AS $function$
DECLARE ...
BEGIN
    -- [CRITICAL fix, review #1] Tenant authorization — this is SECURITY DEFINER
    -- and takes a bare p_restaurant_id, so without this any authenticated user
    -- could mutate another tenant's stock. Matches complete_production_run.
    IF NOT public.user_has_restaurant_access(p_restaurant_id) THEN
        RAISE EXCEPTION 'Not authorized for this restaurant';
    END IF;
    ...
    FOR v_sale IN
        SELECT item_name, quantity, sale_date, created_at, id,
               sale_date::text AS sale_date_text, sale_time::text AS sale_time_text,
               external_order_id
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
          AND sale_date BETWEEN p_start_date AND p_end_date
          -- [MAJOR fix, review #2] Sargable keyset predicate. NO leading
          -- `p_after_id IS NULL OR ...` disjunct (that made the row-comparison a
          -- Filter, re-walking the range from the start each batch → O(n²)).
          -- Sentinel-coalesced constants keep it a pushable index bound → O(n).
          AND (sale_date, created_at, id) > (
                COALESCE(p_after_sale_date,  '-infinity'::date),
                COALESCE(p_after_created_at, '-infinity'::timestamptz),
                COALESCE(p_after_id, '00000000-0000-0000-0000-000000000000'::uuid))
        ORDER BY sale_date, created_at, id        -- deterministic total order (id unique)
        LIMIT p_batch_size
    LOOP
        v_batch_count := v_batch_count + 1;
        v_last_sale_date := v_sale.sale_date;
        v_last_created_at := v_sale.created_at;
        v_last_id := v_sale.id;
        BEGIN
            v_deduction_result := public.process_unified_inventory_deduction(
              p_restaurant_id, v_sale.item_name, v_sale.quantity::integer,
              v_sale.sale_date_text, v_sale.external_order_id,
              v_sale.sale_time_text, v_restaurant_timezone);
            -- count processed/skipped exactly as today
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            RAISE NOTICE 'Error processing sale %: %', v_sale.item_name, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed',   v_processed_count,
        'skipped',     v_skipped_count,
        'errors',      v_error_count,
        'batch_count', v_batch_count,
        'done',        (v_batch_count < p_batch_size),   -- short batch = finished
        'next_cursor', CASE WHEN v_batch_count < p_batch_size THEN NULL
                            ELSE jsonb_build_object(
                                'sale_date',  v_last_sale_date,
                                'created_at', v_last_created_at,
                                'id',         v_last_id) END
    );
END;
$function$;
```

- **Tenant authz (review #1, critical)** — `user_has_restaurant_access(p_restaurant_id)`
  is an existing STABLE SECURITY DEFINER helper (checks `user_restaurants` for
  `auth.uid()`), guaranteed present in prod. Membership-only (no role gate), so
  chef / collaborator_inventory keep access, matching `complete_production_run`.
- **Sargable cursor (review #2, major)** — sentinel `COALESCE` instead of an `OR`
  keeps the row comparison a pushable index bound, so total cost stays **O(n)**,
  not O(n²) re-walks. Applies the [2026-05-17] "bound total, not per-call" lesson
  at the SQL layer.
- **Cursor `(sale_date, created_at, id)`** — all `NOT NULL`, `id` unique PK →
  strict total order → **no skip/dup at batch boundaries** ([2026-07-06] lesson;
  old `ORDER BY sale_date, created_at` was not unique).
- **`done`** = fewer rows than `p_batch_size`. Exactly-full final batch costs one
  extra empty round-trip — correct, cheap; `next_cursor` is `NULL` then.
- **Idempotency preserved** — `process_unified_inventory_deduction`'s
  `reference_id` dedup skips already-processed sales, so resume/re-run never
  double-counts. By-name + `is_active` resolution + silent-miss unchanged
  ([2026-07-05] shadow-recipe semantics). Each batch is one top-level txn: a
  killed batch rolls back atomically and re-runs safely from the same cursor.

### 2. Supporting indexes (per-row cost + cursor scan)

```sql
-- Dedup EXISTS is currently a scan of the restaurant's txns per sale.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_dedup
  ON public.inventory_transactions (restaurant_id, reference_id, transaction_type);

-- Backs the keyset ORDER BY + range within a restaurant.
-- [MAJOR fix, review #3] The existing idx_unified_sales_restaurant_date
-- (restaurant_id, sale_date) is a strict prefix of this wider index, so the
-- wide one fully subsumes it. unified_sales is a hot-write POS-sync table, so
-- keeping both would double index-maintenance per INSERT for no query gain.
-- Drop the narrow one and replace with the keyset index.
DROP INDEX IF EXISTS public.idx_unified_sales_restaurant_date;
CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_keyset
  ON public.unified_sales (restaurant_id, sale_date, created_at, id);

-- Recipe lookup: (pos_item_name = X OR name = X) with only `name` indexed today.
-- Two partial indexes → planner BitmapOrs them; partial predicate matches the
-- query's `is_active = true` exactly (no residual filter). (review confirmed)
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_pos_item_name
  ON public.recipes (restaurant_id, pos_item_name) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_name
  ON public.recipes (restaurant_id, name) WHERE is_active = true;

-- Grants: no explicit GRANT targeted the old signature; Supabase schema-level
-- default privileges re-apply EXECUTE to anon/authenticated/service_role on the
-- recreated function (same as noted for process_unified_inventory_deduction in
-- 20260705000000). No manual GRANT needed. (review #4)
```

Plain (non-`CONCURRENTLY`) `CREATE INDEX` is fine at these sizes (163k / 7.5k /
580 rows) — sub-second builds, brief lock, keeps the migration transactional.
If a low-traffic deploy window can't be guaranteed at larger scale, the repo has
`CREATE INDEX CONCURRENTLY` precedent to switch to. `idx_recipes_name` (global,
non-partial) is left as-is — tiny table, possibly used by other queries; out of
scope to drop here. (review #5)

### 3. Hook — loop until done with progress

`src/hooks/useBulkInventoryDeduction.tsx`. **Explicit signature** (review #3):
`onProgress` is a per-call parameter; progress *state* lives in the dialog
component's `useState`, not in the hook. Keeps the hook's existing imperative
`useCallback` style — no conversion to `useMutation` needed.

```ts
export interface BulkProgress { processed: number; skipped: number; errors: number; batches: number; }
type Cursor = { sale_date: string; created_at: string; id: string } | null;

const MAX_BATCHES = 1000; // 500k-row safety cap ([2026-05-17] bound total, not per-call)

const bulkProcessHistoricalSales = useCallback(async (
  restaurantId: string, startDate: string, endDate: string,
  onProgress?: (p: BulkProgress) => void,
): Promise<BulkProcessResult | null> => {
  setLoading(true);
  const totals = { processed: 0, skipped: 0, errors: 0 };
  let cursor: Cursor = null, done = false, batches = 0;
  try {
    while (!done) {
      if (++batches > MAX_BATCHES)
        throw new Error(`Reached the ${MAX_BATCHES}-batch safety cap. Progress was saved — re-run to resume from where it stopped.`);
      const { data, error } = await supabase.rpc('bulk_process_historical_sales', {
        p_restaurant_id: restaurantId, p_start_date: startDate, p_end_date: endDate,
        p_batch_size: 500,
        p_after_sale_date: cursor?.sale_date ?? null,
        p_after_created_at: cursor?.created_at ?? null,
        p_after_id: cursor?.id ?? null,
      });
      if (error) throw error;
      totals.processed += data.processed; totals.skipped += data.skipped; totals.errors += data.errors;
      cursor = data.next_cursor; done = data.done;
      onProgress?.({ ...totals, batches });
    }
    // [MAJOR fix, review #4] refresh derived React-Query views (food cost, COGS,
    // consumption, P&L, unified-sales). Blanket invalidation is acceptable for a
    // rare, user-initiated bulk op. NB: the products list uses an imperative
    // useState hook (useProducts), not React Query — it refreshes on its own and
    // lives on a different page, so per-key products invalidation is N/A here.
    queryClient.invalidateQueries();
    toast({ title: 'Bulk Processing Complete',
            description: `Processed ${totals.processed} sales, skipped ${totals.skipped}, ${totals.errors} errors.` });
    return { ...totals, total: totals.processed + totals.skipped + totals.errors };
  } catch (error: any) {
    // [MAJOR fix, review #5] report partial progress + that re-run resumes safely.
    queryClient.invalidateQueries(); // partial totals were still written
    toast({ title: 'Bulk processing interrupted', variant: 'destructive',
            description: `Processed ${totals.processed} sales (${totals.errors} errors) before: ${error.message}. Safe to re-run — it resumes where it left off.` });
    return null;
  } finally { setLoading(false); }
}, [toast, queryClient]);
```

### 4. UI — live progress

`src/components/BulkInventoryDeductionDialog.tsx`:

- **Live count**, text-only (review #6 — the RPC returns no range total, so no
  percentage bar / shadcn `Progress`). Keep the existing `Loader2` spinner +
  a running count. Concrete styling (review #7): `text-[13px] text-muted-foreground`
  inside the existing `<Alert>`/dialog-body block.
- **`aria-live` (review #2)**: render the count in
  `<div role="status" aria-live="polite">Processed {n} sales…</div>`. ~500-row
  batch cadence is a fine `polite` update rate; no debouncing.
- **Gate closing mid-run (review #1)**: `onOpenChange={(v) => { if (loading) return; setOpen(v); }}`
  and disable/hide Cancel while `loading` (matches the existing `disabled={!isValid || loading}`
  on Process). Prevents a background loop from firing a toast onto a dialog the
  user thinks they cancelled. (No `AbortController` in v1 — gating close is
  sufficient; abort is a possible future add.)
- **Terminal state (review #8)**: on error/partial, show the accumulated totals
  inline in the `<Alert>` (not toast-only) before the existing 2s auto-close, so
  a missed toast doesn't hide the outcome.
- Three-state rendering preserved; semantic tokens only.

## Testing

| Test | Location | Asserts |
|---|---|---|
| pgTAP: batching correctness | `supabase/tests/bulk_process_historical_sales_batching.sql` | seed sales incl. **rows sharing `sale_date`+`created_at`**; small `p_batch_size`; cursor advances; every row processed exactly once across boundaries; `done` flips only on short batch; **idempotent re-run** processes 0 new; exact-multiple final batch → one extra empty `done` call. |
| pgTAP: tenant authz | same file | calling with a `p_restaurant_id` the current role can't access **raises** `Not authorized for this restaurant`; authorized path succeeds. |
| unit: hook loop | `tests/unit/useBulkInventoryDeduction.test.ts` | mocked rpc returns 2 batches then done → loops, accumulates totals, threads cursor, stops on `done`, calls `onProgress` per batch; `MAX_BATCHES` guard throws; rpc error → partial-total toast + `invalidateQueries` called; success → `invalidateQueries` called. |

## Decided trade-offs

- **User stays on the page during backfill.** Accepted; batches are fast and
  resumable, and closing is gated while running. A background-cron variant
  (Toast/Focus pattern) is the heavier future option if page-close resilience is
  needed.
- **Concurrent-insert keyset skip (review #8).** If a POS sync inserts a row
  whose `(sale_date, created_at, id)` sorts *before* the live cursor mid-backfill,
  this pass skips it — standard keyset-pagination behavior. Not a new bug: the
  real-time per-sale deduction on insert, or a subsequent bulk run, still catches
  it. Accepted.
- **Non-`CONCURRENTLY` indexes.** Brief sub-second lock acceptable at current
  table sizes.
- **Extra params defaulted, old signature dropped.** A 3-arg PostgREST call still
  resolves; no other DB code calls the function (only the hook — confirmed).
- **Deferred (review #7, separate ticket):** `process_unified_inventory_deduction`
  has the same missing-tenant-check gap one layer deeper (also RPC-callable). Not
  fixed here — it needs a service-role bypass for POS-sync callers. Spun off as a
  follow-up task.

## Design-review resolutions

| # | Reviewer | Severity | Resolution |
|---|---|---|---|
| 1 | supabase | critical | **Fixed in design** — `user_has_restaurant_access` guard at function top. |
| 2 | supabase | major | **Fixed in design** — sargable sentinel-COALESCE cursor, no `OR`. |
| 3 | supabase | major | **Fixed in design** — drop narrow `idx_unified_sales_restaurant_date`, add wide keyset index. |
| 4 | supabase | minor | Noted — default privileges re-apply; comment added, no manual GRANT. |
| 5 | supabase | minor | Accepted — `idx_recipes_name` left as-is (tiny table, possible other users). |
| 6 | supabase | minor | Noted — `CONCURRENTLY` precedent documented as future option. |
| 7 | supabase | minor | **Deferred** — follow-up ticket for `process_unified_inventory_deduction`. |
| 8 | supabase | minor | Documented as accepted trade-off. |
| f1 | frontend | major | **Fixed in design** — gate `onOpenChange` + disable Cancel while `loading`. |
| f2 | frontend | major | **Fixed in design** — `role="status" aria-live="polite"` progress region. |
| f3 | frontend | major | **Fixed in design** — explicit `onProgress` param; state in component. |
| f4 | frontend | major | **Fixed in design** — `queryClient.invalidateQueries()` on success + partial. |
| f5 | frontend | major | **Fixed in design** — error toast reports partial totals + "safe to re-run". |
| f6–8 | frontend | minor | **Fixed in design** — text-only count, concrete styling, inline terminal state. |

## Migration filename

Pick a unique 14-digit prefix at implementation time (avoid the
[2026-07-08] collision) — check `ls supabase/migrations/ | tail` first, e.g.
`202607201200XX_bulk_deduction_keyset_batching.sql`.
