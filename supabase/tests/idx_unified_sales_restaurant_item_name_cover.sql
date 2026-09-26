-- Verifies the covering index backing get_recipe_sales_stats
-- (supabase/migrations/20260727120000_get_recipe_sales_stats.sql) and
-- get_unmapped_sale_item_names
-- (supabase/migrations/20260728120000_get_unmapped_sale_item_names.sql).
-- Design: docs/superpowers/specs/2026-09-26-recipe-sales-stats-timeout-design.md
--
-- The index carries the three columns get_recipe_sales_stats reads, so the
-- aggregate is an index-only scan. The plain (restaurant_id, item_name) index
-- it replaces sent every matching sale row to the heap, which timed out on
-- large tenants ("canceling statement due to statement timeout").
--
-- CONCURRENTLY cannot run inside pgTAP's wrapping transaction, so the index
-- itself is created by its own migration files
-- (supabase/migrations/20260926120000_idx_unified_sales_restaurant_item_name_cover.sql
-- and the two after it) applied before this test runs, not inline here. This
-- test only asserts on the catalog state left behind by those migrations.
BEGIN;
SELECT plan(7);

SELECT has_index(
  'public', 'unified_sales', 'idx_unified_sales_restaurant_item_name_cover',
  'unified_sales has idx_unified_sales_restaurant_item_name_cover'
);

SELECT ok(
  (
    SELECT indexdef ~* '\(restaurant_id, item_name\) INCLUDE'
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'unified_sales'
      AND indexname = 'idx_unified_sales_restaurant_item_name_cover'
  ),
  'index key columns are (restaurant_id, item_name) in that order'
);

-- Each of these is read by get_recipe_sales_stats. Drop one and the scan goes
-- back to the heap for every row.
SELECT ok(
  (
    SELECT indexdef ~* 'INCLUDE \(quantity, total_price, unit_price\)'
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'unified_sales'
      AND indexname = 'idx_unified_sales_restaurant_item_name_cover'
  ),
  'index INCLUDEs quantity, total_price and unit_price'
);

-- Pinned deliberately: a partial index on `unit_price IS NOT NULL` is
-- unusable for get_unmapped_sale_item_names, which has no such filter.
SELECT ok(
  (
    SELECT indexdef !~* 'where'
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'unified_sales'
      AND indexname = 'idx_unified_sales_restaurant_item_name_cover'
  ),
  'index is NOT partial, so both RPCs can use it'
);

-- A failed CREATE INDEX CONCURRENTLY leaves an INVALID index that the planner
-- ignores and that IF NOT EXISTS then skips on a retry.
SELECT ok(
  (
    SELECT i.indisvalid AND i.indisready
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_unified_sales_restaurant_item_name_cover')
  ),
  'index is valid and ready'
);

-- The covering index makes the old one redundant: same key columns, same order.
SELECT hasnt_index(
  'public', 'unified_sales', 'idx_unified_sales_restaurant_item_name',
  'the redundant idx_unified_sales_restaurant_item_name is gone'
);

-- The plan check runs EXPLAIN on the function body, not on the call: the
-- function has `SET search_path`, so Postgres does not inline it and EXPLAIN on
-- the call shows only a Function Scan. The query is a copy of the body at
-- 20260727120000_get_recipe_sales_stats.sql:34-43. When a migration changes
-- that body, change this copy too. Seq and bitmap scans are off so the
-- result does not depend on the table statistics of the test database. It
-- asserts the index name and not "Index Only Scan": this transaction cannot
-- VACUUM, so the visibility map is empty and the planner may pick an Index Scan.
SET LOCAL enable_seqscan = off;
SET LOCAL enable_bitmapscan = off;

CREATE TEMP TABLE recipe_sales_stats_plan (line TEXT) ON COMMIT DROP;

DO $$
DECLARE
  v_line TEXT;
BEGIN
  FOR v_line IN
    EXPLAIN (COSTS OFF)
    SELECT us.item_name,
           SUM(COALESCE(us.total_price, 0)) / NULLIF(SUM(COALESCE(NULLIF(us.quantity, 0), 1)), 0)
    FROM unified_sales us
    JOIN recipes r
      ON r.restaurant_id = us.restaurant_id
     AND r.pos_item_name = us.item_name
     AND r.is_active
    WHERE us.restaurant_id = '00000000-0000-0000-0000-000000000000'::uuid
      AND us.unit_price IS NOT NULL
    GROUP BY us.item_name
  LOOP
    INSERT INTO recipe_sales_stats_plan (line) VALUES (v_line);
  END LOOP;
END $$;

SELECT ok(
  EXISTS (
    SELECT 1 FROM recipe_sales_stats_plan
    WHERE line LIKE '%idx_unified_sales_restaurant_item_name_cover%'
  ),
  'the get_recipe_sales_stats query plan uses the covering index'
);

SELECT * FROM finish();
ROLLBACK;
