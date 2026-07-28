-- Composite index backing the two per-restaurant lookups keyed on
-- (restaurant_id, item_name): get_recipe_sales_stats
-- (20260727120000_get_recipe_sales_stats.sql), which groups unified_sales by
-- that pair, and get_unmapped_sale_item_names
-- (20260728120000_get_unmapped_sale_item_names.sql), which takes a DISTINCT
-- over it.
-- Deliberately NOT partial on `unit_price IS NOT NULL`: that predicate would
-- trim noise rows for the stats RPC but make the index unusable for the
-- unmapped-names one, which has no such filter. The stats RPC reads
-- total_price and quantity from the heap regardless, so it never gained an
-- index-only scan from being partial -- one shared index costs less on write
-- than two overlapping ones.
-- CONCURRENTLY cannot run inside a transaction, so this lives in its own
-- migration file containing only this statement.
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.9
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unified_sales_restaurant_item_name
  ON public.unified_sales (restaurant_id, item_name);
