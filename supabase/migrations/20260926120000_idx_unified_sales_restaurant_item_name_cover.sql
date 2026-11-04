-- supabase: no-transaction
-- Covering index for get_recipe_sales_stats
-- (20260727120000_get_recipe_sales_stats.sql). The RPC aggregates all-time
-- sales per mapped item and reads quantity, total_price and unit_price from
-- every matching row. The plain (restaurant_id, item_name) index
-- (20260727130000) found the rows but sent each one to the heap, about one
-- random page per row. On large tenants that went past the 8s statement
-- timeout for `authenticated`, and the recipes load on /pos-sales and /recipes
-- failed with "canceling statement due to statement timeout".
-- With the three columns in INCLUDE, the aggregate is an index-only scan.
--
-- Same key columns in the same order as the old index, and NOT partial, so
-- get_unmapped_sale_item_names (20260728120000) keeps an index too.
-- The old index is deleted two migrations later, after a validity check.
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-09-26-recipe-sales-stats-timeout-design.md
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_restaurant_item_name_cover
  ON public.unified_sales (restaurant_id, item_name)
  INCLUDE (quantity, total_price, unit_price);
