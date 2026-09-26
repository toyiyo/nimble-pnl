# Design: fix the statement timeout in `get_recipe_sales_stats`

Status: approved by the user (option "Covering index").

## Problem

The POS sales page shows this toast on load:

> Error fetching recipes — canceling statement due to statement timeout

The toast comes from `useRecipes` (`src/hooks/useRecipes.tsx:662-666`).
`POSSales` mounts that hook (`src/pages/POSSales.tsx:145`).

`fetchRecipesData` runs four queries in one `Promise.all`
(`src/hooks/useRecipes.tsx:519-554`). One of them is the RPC
`get_recipe_sales_stats` (`src/hooks/useRecipes.tsx:551`). A failure of any
query rejects the whole load, so one slow RPC removes every recipe from the page.

## Root cause

`get_recipe_sales_stats` aggregates **all-time** sales for every mapped item
(`supabase/migrations/20260727120000_get_recipe_sales_stats.sql:34-43`). It
reads `total_price`, `quantity` and `unit_price` for each row.

The only index on the key pair is `idx_unified_sales_restaurant_item_name`
on `(restaurant_id, item_name)`
(`supabase/migrations/20260727130000_idx_unified_sales_restaurant_item_name.sql:16-17`).
The index has no value columns. So Postgres must read the heap page of every
matching sale row. Sale rows for one item spread across the whole table, so
this is close to one random heap page per row.

The RLS policy on `unified_sales` is not the cause. It is an `EXISTS` on
`user_restaurants`
(`supabase/migrations/20251031010736_41ce38d5-19a1-4945-8e83-c886ebc471f3.sql:13-22`).
The planner runs it as a hashed subplan, one time per query (see the
benchmark plan below).

## Benchmark (local Postgres 16)

Setup: 3M `unified_sales` rows, 2M for one tenant, 400 item names, 150 mapped
recipes, a `raw_data` jsonb column of about 300 bytes per row. Same RLS
policy shape as production. Query run as `authenticated`. Cold cache: server
restart and OS page cache flush before each run.

| Index | Plan on `unified_sales` | Buffers | Cold time |
|---|---|---|---|
| `(restaurant_id, item_name)` (current) | Bitmap Heap Scan, 750,000 heap blocks | 751k | 7.3 s |
| `(restaurant_id, item_name) INCLUDE (quantity, total_price, unit_price)` | Index Only Scan, `Heap Fetches: 0` | 6.5k | 0.9 s |

The benchmark index is named `idx_us_cover`. It has the same definition as
`idx_unified_sales_restaurant_item_name_cover`.

### Second run: a tenant of production size

A comment in `supabase/migrations/20260728140000_search_pos_items.sql:105`
gives the largest production tenant as about 70k sale rows (July 2026). So the
second run uses a tenant with 100k rows, mixed in time order with 900k rows of
other tenants. 37,500 of the rows match a mapped recipe.

| Index | Pages read (cold) |
|---|---|
| `(restaurant_id, item_name)` (current) | 38,000 (23,156 from disk) |
| covering index | 900 (299 from disk) |

The local disk is NVMe, so both runs finish in under 100 ms here. On a network
volume each random page read costs about 0.5 to 1 ms. At that cost, 23k cold
reads are 11 to 23 s, which is more than the timeout. The covering index needs
about 300 reads.

### Premise not confirmed on production

The `supabase-prod` MCP server is not connected in this session. So the
diagnosis has no production `EXPLAIN (ANALYZE, BUFFERS)`. Before merge, run
the query body of `get_recipe_sales_stats` with `EXPLAIN (ANALYZE, BUFFERS)`
for the affected restaurant. A Bitmap Heap Scan on `unified_sales` with a
high `read=` count confirms this design.

Supabase sets `statement_timeout = 8s` for the `authenticated` role
(https://supabase.com/docs/guides/database/postgres/timeouts). No file in this
repo changes it. The current plan is at the limit with 2M rows. A larger tenant or a slower disk
goes over it.

## Fix

Replace the index with a covering index:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_restaurant_item_name_cover
  ON public.unified_sales (restaurant_id, item_name)
  INCLUDE (quantity, total_price, unit_price);
```

Then run a guard migration. A failed `CREATE INDEX CONCURRENTLY` leaves an
INVALID index behind, and a retry with `IF NOT EXISTS` skips it. Without the
guard, the next migration deletes the only valid index. The guard stops the
migration run if the new index is missing or not valid:

```sql
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_unified_sales_restaurant_item_name_cover')
      AND i.indisvalid
      AND i.indisready
  ) THEN
    RAISE EXCEPTION '...';  -- the message gives the manual rebuild steps
  END IF;
END $$;
```

The CLI records the create migration as applied even when `IF NOT EXISTS`
skipped an INVALID index. So the error message tells the operator to build the
index by hand, not to push again.

Then delete the old index in a third migration:

```sql
DROP INDEX CONCURRENTLY IF EXISTS public.idx_unified_sales_restaurant_item_name;
```

Rules that apply:

- `CONCURRENTLY` cannot run in a transaction. Each statement goes in its own
  migration file. This is the existing convention
  (`supabase/migrations/20260727130000_idx_unified_sales_restaurant_item_name.sql:13-14`).
- The new index is **not partial**. `get_unmapped_sale_item_names` has no
  `unit_price` filter
  (`supabase/migrations/20260728120000_get_unmapped_sale_item_names.sql:39-51`)
  and must keep an index. The benchmark shows its plan uses the new index.
- The key columns stay the same and in the same order. So every query that
  used the old index can use the new one.
- The create runs before the drop. There is no time with no index.

No function body changes. No TypeScript changes. The numbers on the page do
not change, because the query does not change.

## Decided trade-offs

- **Index size.** `INCLUDE` indexes do not use btree deduplication, and each
  entry carries three numeric values. The index is larger than the old one.
  The old index is deleted, so the write cost stays at one index.
- **Measured size.** In the benchmark (3M rows), the old index is 21 MB and
  the new index is 169 MB. The primary key is 121 MB and the heap is about
  1.2 GB. The production row count is not known here: the `supabase-prod` MCP
  server is not connected in this session. The build is `CONCURRENTLY`, so it
  does not block writes. Apply it at a low-traffic time.
- **HOT updates.** After this change, an `UPDATE` that changes `quantity`,
  `total_price` or `unit_price` cannot be a HOT update. The Toast upsert sets
  these three from `EXCLUDED`
  (`supabase/migrations/20260127000000_toast_sync_improvements.sql:108-110`).
  Postgres keeps an update HOT when the values do not change, so only a real
  price or quantity correction on re-sync writes to the index. The
  categorization paths change `category_id` and related columns.
- **`get_unmapped_sale_item_names` still reads the heap.** It filters on
  `parent_sale_id`, which is not in the index
  (`supabase/migrations/20260728120000_get_unmapped_sale_item_names.sql:42`).
  Its plan does not change from today. It walks a larger index (about 8
  times the old size), but its cost is the heap reads, which stay the same.
- **Rollback.** To restore the old index by hand, run
  `CREATE INDEX CONCURRENTLY idx_unified_sales_restaurant_item_name ON public.unified_sales (restaurant_id, item_name);`.
- **Visibility map.** An index-only scan skips the heap only for all-visible
  pages. Recent sale rows sit on pages that autovacuum has not marked yet.
  Those pages still need a heap fetch. Old rows are the bulk, so the gain
  stays large.
- **All-time aggregate stays.** The user rejected a time window, because it
  changes what `avg_sale_price` means.
- **Non-fatal stats rejected.** The user rejected a catch in the client. It
  would show "no sales data" when the real state is "query failed".

## Tests

- Rewrite the index test and rename it to
  `supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql`. It checks:
  the new index exists, the key columns are `(restaurant_id, item_name)`,
  the `INCLUDE` list has `quantity`, `total_price`, `unit_price`, the index is
  not partial, and the old index does not exist.
- Add a pgTAP plan check. Run `EXPLAIN` on the function's query body, not on
  the call: `SET search_path` stops Postgres from inlining the function. Turn
  off `enable_seqscan` and `enable_bitmapscan`. Assert that the plan names the
  new index. Do not assert `Index Only Scan`: the test cannot `VACUUM` inside
  its transaction, so the visibility map stays empty.
- The existing `supabase/tests/get_recipe_sales_stats.sql` must still pass.
  It proves the numbers do not change.

E2E: justified exception. The change is a pure index change with no behavior
change. A plan change is not visible through the UI in CI data volumes.

## Appendix: benchmark evidence

Current index, cold cache (trimmed):

```
->  Bitmap Heap Scan on unified_sales us (actual time=1.530..48.548 rows=5000 loops=150)
      Filter: ((unit_price IS NOT NULL) AND (hashed SubPlan 2))
      Buffers: shared hit=701579 read=49520
Execution Time: ~7300 ms
```

Covering index, cold cache (trimmed):

```
->  Index Only Scan using idx_us_cover on unified_sales us (actual time=0.204..1.898 rows=5000 loops=150)
      Heap Fetches: 0
      Buffers: shared hit=1089 read=5448
Execution Time: 905.862 ms
```

`get_unmapped_sale_item_names` body with the covering index only:

```
->  Index Scan using idx_us_cover on unified_sales us
```
