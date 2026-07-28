-- Partial composite index backing get_recipe_sales_stats
-- (20260727120000_get_recipe_sales_stats.sql), which groups unified_sales by
-- (restaurant_id, item_name) filtering unit_price IS NOT NULL. Partial and
-- matching the RPC's predicate excludes noise rows (e.g. "Sales Tax" line
-- items) from the index entirely.
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.9
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_restaurant_item_name
  ON public.unified_sales (restaurant_id, item_name)
  WHERE unit_price IS NOT NULL;
