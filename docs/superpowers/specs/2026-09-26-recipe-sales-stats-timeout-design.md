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

Supabase sets `statement_timeout = 8s` for the `authenticated` role. The
current plan is at the limit with 2M rows. A larger tenant or a slower disk
goes over it.

## Fix

Replace the index with a covering index:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_restaurant_item_name_cover
  ON public.unified_sales (restaurant_id, item_name)
  INCLUDE (quantity, total_price, unit_price);
```

Then delete the old index in a second migration:

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
- **Visibility map.** An index-only scan skips the heap only for all-visible
  pages. Recent sale rows sit on pages that autovacuum has not marked yet.
  Those pages still need a heap fetch. Old rows are the bulk, so the gain
  stays large.
- **All-time aggregate stays.** The user rejected a time window, because it
  changes what `avg_sale_price` means.
- **Non-fatal stats rejected.** The user rejected a catch in the client. It
  would show "no sales data" when the real state is "query failed".

## Tests

- Rewrite `supabase/tests/idx_unified_sales_restaurant_item_name.sql` to check:
  the new index exists, the key columns are `(restaurant_id, item_name)`,
  the `INCLUDE` list has `quantity`, `total_price`, `unit_price`, the index is
  not partial, and the old index does not exist.
- Add a pgTAP plan check: with sequential scans off, `get_recipe_sales_stats`'s
  query uses an `Index Only Scan` on the new index.
- The existing `supabase/tests/get_recipe_sales_stats.sql` must still pass.
  It proves the numbers do not change.

E2E: justified exception. The change is a pure index change with no behavior
change. A plan change is not visible through the UI in CI data volumes.
