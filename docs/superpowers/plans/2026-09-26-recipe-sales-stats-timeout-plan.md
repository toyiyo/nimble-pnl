# Plan: fix the `get_recipe_sales_stats` statement timeout

Design: `docs/superpowers/specs/2026-09-26-recipe-sales-stats-timeout-design.md`

## Task 1 — RED: rewrite the index pgTAP test

File: `supabase/tests/idx_unified_sales_restaurant_item_name_cover.sql`
(renamed from `idx_unified_sales_restaurant_item_name.sql`)

Assert:
1. `idx_unified_sales_restaurant_item_name_cover` exists.
2. The key columns are `(restaurant_id, item_name)`, in that order.
3. The `INCLUDE` columns are `quantity`, `total_price`, `unit_price`.
4. The index is not partial.
5. The index is valid (`pg_index.indisvalid`).
6. `idx_unified_sales_restaurant_item_name` does not exist.
7. With `enable_seqscan` and `enable_bitmapscan` off, `EXPLAIN` of the
   `get_recipe_sales_stats` body names the new index.

Run it. It must fail on the current schema.

## Task 2 — GREEN: three migrations, one statement each

1. `20260926120000_idx_unified_sales_restaurant_item_name_cover.sql` —
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS ... INCLUDE (quantity, total_price, unit_price)`.
2. `20260926120100_assert_idx_unified_sales_item_name_cover_valid.sql` —
   `DO` block that raises when the new index is missing or not valid.
3. `20260926120200_drop_idx_unified_sales_restaurant_item_name.sql` —
   `DROP INDEX CONCURRENTLY IF EXISTS public.idx_unified_sales_restaurant_item_name`.

Run `npx supabase db reset`, then the index test and
`supabase/tests/get_recipe_sales_stats.sql`. Both must pass.

## Task 3 — Verify

Run `npm run test:db`, `npm run typecheck`, `npm run lint`, `npm run test`,
`npm run build`.
