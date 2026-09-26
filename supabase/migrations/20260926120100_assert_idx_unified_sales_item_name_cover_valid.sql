-- Guard between the covering-index build (20260926120000) and the delete of
-- the old index (20260926120200).
-- A failed CREATE INDEX CONCURRENTLY leaves an INVALID index behind. A retry
-- with IF NOT EXISTS then skips the build, and the next migration would delete
-- the only index the planner can use. Stop the migration run here instead.
-- Design: docs/superpowers/specs/2026-09-26-recipe-sales-stats-timeout-design.md
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_unified_sales_restaurant_item_name_cover')
      AND i.indisvalid
      AND i.indisready
  ) THEN
    -- The CLI records 20260926120000 as applied even when IF NOT EXISTS
    -- skipped an INVALID index, so a second push does not run it again. The
    -- operator must build the index by hand.
    RAISE EXCEPTION 'idx_unified_sales_restaurant_item_name_cover is missing or INVALID; '
      'run DROP INDEX CONCURRENTLY IF EXISTS public.idx_unified_sales_restaurant_item_name_cover; '
      'then CREATE INDEX CONCURRENTLY idx_unified_sales_restaurant_item_name_cover '
      'ON public.unified_sales (restaurant_id, item_name) INCLUDE (quantity, total_price, unit_price); '
      'then push again';
  END IF;
END $$;
