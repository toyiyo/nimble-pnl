-- get_unmapped_sale_item_names: the POS item names a restaurant sells that no
-- recipe claims, resolved server-side for the "AI Recipe Suggestions" banner on
-- /recipes. Replaces the client-side diff, which paged up to 500 unified_sales
-- rows and ran a second `recipes` query on every recipes-page load just to
-- compute a list whose first five entries are all the banner ever shows.
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.11
--
-- Behaviour mirrors the TS it replaces (src/utils/recipeMapping.ts +
-- useUnifiedSales.unmappedItems), deliberately, so the banner's contents do not
-- shift in this perf change:
--   * lower() on both sides and NOTHING else -- the TS compares
--     `itemName.toLowerCase()` against a set of `pos_item_name.toLowerCase()`.
--     No trim, no unaccent: adding either here would silently change which
--     items the banner offers.
--   * no is_active filter on recipes -- createMappedItemNamesSet indexes every
--     recipe carrying a pos_item_name, so an inactive mapped recipe suppresses
--     its item here too.
--   * parent_sale_id IS NULL -- split child rows are not their own POS items.
-- The one intentional difference is ORDER BY: the TS returned names in sales
-- page order, so which five the banner showed drifted with the sales feed.
--
-- p_limit bounds the result well under the PostgREST 1000-row response cap, so
-- there is no truncation to detect client-side. The banner shows 5 names and a
-- count; it does not need every name, and the count was already an
-- approximation when it came off a single 500-row sales page.
--
-- SECURITY INVOKER + no explicit membership check: RLS on unified_sales and
-- recipes enforces tenant isolation regardless of the p_restaurant_id passed.
CREATE OR REPLACE FUNCTION public.get_unmapped_sale_item_names(
  p_restaurant_id UUID,
  p_limit INTEGER DEFAULT 200
)
RETURNS TABLE (item_name TEXT)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT DISTINCT us.item_name
  FROM unified_sales us
  WHERE us.restaurant_id = p_restaurant_id
    AND us.parent_sale_id IS NULL
    AND us.item_name IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM recipes r
      WHERE r.restaurant_id = p_restaurant_id
        AND r.pos_item_name IS NOT NULL
        AND lower(r.pos_item_name) = lower(us.item_name)
    )
  ORDER BY 1
  LIMIT GREATEST(p_limit, 0);
$$;

-- Re-issued explicitly: CREATE OR REPLACE resets ACLs.
GRANT EXECUTE ON FUNCTION public.get_unmapped_sale_item_names(UUID, INTEGER) TO authenticated;
