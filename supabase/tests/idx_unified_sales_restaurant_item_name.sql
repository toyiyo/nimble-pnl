-- Verifies the composite index backing get_recipe_sales_stats
-- (supabase/migrations/20260727120000_get_recipe_sales_stats.sql) and
-- get_unmapped_sale_item_names
-- (supabase/migrations/20260728120000_get_unmapped_sale_item_names.sql) exists
-- with the expected columns.
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.9
--
-- CONCURRENTLY cannot run inside pgTAP's wrapping transaction, so the index
-- itself is created by its own migration file
-- (supabase/migrations/20260727130000_idx_unified_sales_restaurant_item_name.sql)
-- applied before this test runs, not inline here. This test only asserts on
-- the catalog state left behind by that migration.
BEGIN;
SELECT plan(3);

SELECT has_index(
  'public', 'unified_sales', 'idx_unified_sales_restaurant_item_name',
  'unified_sales has idx_unified_sales_restaurant_item_name'
);

SELECT ok(
  (
    SELECT indexdef ~* 'restaurant_id.*item_name'
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'unified_sales'
      AND indexname = 'idx_unified_sales_restaurant_item_name'
  ),
  'index columns are (restaurant_id, item_name) in that order'
);

-- Pinned deliberately: the index started out partial on
-- `unit_price IS NOT NULL`, which get_unmapped_sale_item_names cannot use --
-- it has no such filter. Re-adding the predicate would silently drop that RPC
-- back to a sequential scan of the restaurant's sales.
SELECT ok(
  (
    SELECT indexdef !~* 'where'
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'unified_sales'
      AND indexname = 'idx_unified_sales_restaurant_item_name'
  ),
  'index is NOT partial, so both RPCs can use it'
);

SELECT * FROM finish();
ROLLBACK;
