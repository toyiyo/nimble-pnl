-- Guard between the covering-index build (20260926120000) and the delete of
-- the old index (20260926120200).
-- A failed CREATE INDEX CONCURRENTLY leaves an INVALID index behind. A retry
-- with IF NOT EXISTS then skips the build, and the next migration would delete
-- the only index the planner can use. Stop the migration run here instead.
-- The definition check covers a valid index that has the right name but a
-- different table, keys, INCLUDE list or predicate (for example, from a manual
-- recovery). IF NOT EXISTS skips the build for that index too.
-- Design: docs/superpowers/specs/2026-09-26-recipe-sales-stats-timeout-design.md
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.idx_unified_sales_restaurant_item_name_cover')
      AND i.indisvalid
      AND i.indisready
      AND pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX idx_unified_sales_restaurant_item_name_cover '
        'ON public.unified_sales USING btree (restaurant_id, item_name) '
        'INCLUDE (quantity, total_price, unit_price)'
  ) THEN
    -- The CLI records 20260926120000 as applied even when IF NOT EXISTS
    -- skipped an INVALID index, so a second push does not run it again. The
    -- operator must build the index by hand.
    RAISE EXCEPTION 'idx_unified_sales_restaurant_item_name_cover is missing, INVALID or has a different definition; '
      'run DROP INDEX CONCURRENTLY IF EXISTS public.idx_unified_sales_restaurant_item_name_cover; '
      'then CREATE INDEX CONCURRENTLY idx_unified_sales_restaurant_item_name_cover '
      'ON public.unified_sales (restaurant_id, item_name) INCLUDE (quantity, total_price, unit_price); '
      'then push again';
  END IF;
END $$;
