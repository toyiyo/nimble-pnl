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
...
    FOR v_sale IN
        SELECT item_name, quantity, sale_date, created_at, id,
               sale_date::text AS sale_date_text, sale_time::text AS sale_time_text,
               external_order_id
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
          AND sale_date BETWEEN p_start_date AND p_end_date
          AND (
            p_after_id IS NULL
            OR (sale_date, created_at, id) > (p_after_sale_date, p_after_created_at, p_after_id)
          )
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
$function$;
```

- **Cursor `(sale_date, created_at, id)`** — all `NOT NULL`, `id` is the unique
  PK, so the tuple is a strict total order → row-value comparison paginates with
  **no skipped or duplicated rows at batch boundaries**. Directly applies the
  [2026-07-06] pagination-determinism lesson (the old `ORDER BY sale_date,
  created_at` was not unique).
- **`done`** = fewer rows than `p_batch_size` came back. Exactly-full final batch
  costs one extra empty round-trip — correct, cheap.
- **Idempotency preserved**: `process_unified_inventory_deduction`'s
  `reference_id` dedup (`EXISTS ... transaction_type`) means already-processed
  sales are skipped, so re-running / resuming double-counts nothing. The
  by-name + `is_active` recipe resolution and silent-miss behavior are unchanged
  (respecting the [2026-07-05] shadow-recipe semantics).

### 2. Supporting indexes (per-row cost + cursor scan)

```sql
-- Dedup EXISTS is currently a scan of the restaurant's txns per sale.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_dedup
  ON public.inventory_transactions (restaurant_id, reference_id, transaction_type);

-- Backs the keyset ORDER BY + range within a restaurant.
CREATE INDEX IF NOT EXISTS idx_unified_sales_restaurant_keyset
  ON public.unified_sales (restaurant_id, sale_date, created_at, id);

-- Recipe lookup: (pos_item_name = X OR name = X) with only `name` indexed today.
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_pos_item_name
  ON public.recipes (restaurant_id, pos_item_name) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_recipes_restaurant_name
  ON public.recipes (restaurant_id, name) WHERE is_active = true;
```

Plain (non-`CONCURRENTLY`) `CREATE INDEX` is fine at these sizes (163k / 7.5k /
580 rows) and keeps the migration transactional.

### 3. Hook — loop until done with progress

`src/hooks/useBulkInventoryDeduction.tsx`:

```ts
const MAX_BATCHES = 1000; // 500k-row safety cap ([2026-05-17] bound total, not per-call)
let cursor: Cursor | null = null;
let done = false, batches = 0;
const totals = { processed: 0, skipped: 0, errors: 0 };
while (!done) {
  if (++batches > MAX_BATCHES) throw new Error('Backfill exceeded batch cap; re-run to continue.');
  const { data, error } = await supabase.rpc('bulk_process_historical_sales', {
    p_restaurant_id, p_start_date: startDate, p_end_date: endDate,
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
return totals;
```

### 4. UI — live progress

`src/components/BulkInventoryDeductionDialog.tsx`: replace the single spinner
with a running count ("Processed N sales…") driven by `onProgress`, keep the
final summary toast. Three-state rendering preserved; semantic tokens only.

## Testing

| Test | Location | Asserts |
|---|---|---|
| pgTAP: batching correctness | `supabase/tests/bulk_process_historical_sales_batching.sql` | seed sales incl. **rows sharing `sale_date`+`created_at`**; small `p_batch_size`; cursor advances; every row processed exactly once across boundaries; `done` flips only on short batch; **idempotent re-run** processes 0 new. |
| unit: hook loop | `tests/unit/useBulkInventoryDeduction.test.ts` | mocked rpc returns 2 batches then done → loops, accumulates totals, threads cursor, stops on `done`; `MAX_BATCHES` guard throws; rpc error surfaces. |

## Decided trade-offs

- **User stays on the page during backfill.** Accepted for now; batches are fast
  and resumable. A background-cron variant (Toast/Focus pattern) is the heavier
  future option if page-close resilience is needed.
- **Non-`CONCURRENTLY` indexes.** Brief lock acceptable at current table sizes.
- **Extra params defaulted, old signature dropped.** A 3-arg PostgREST call still
  works; no other DB code calls the function (only the hook).

## Migration filename

Pick a unique 14-digit prefix at implementation time (avoid the
[2026-07-08] collision) — check `ls supabase/migrations/ | tail` first, e.g.
`202607201200XX_bulk_deduction_keyset_batching.sql`.
