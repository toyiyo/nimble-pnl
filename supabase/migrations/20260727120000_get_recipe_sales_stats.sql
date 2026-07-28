-- get_recipe_sales_stats: single-round-trip average sale price per POS item
-- name, replacing the per-recipe N+1 sales query in useRecipes.fetchRecipes.
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.5
--
-- coalesce(nullif(quantity,0), 1) is load-bearing: it mirrors the TS it
-- replaces (`sale.quantity || 1`) exactly -- every row with NULL or 0
-- quantity counts as 1 in the denominator, never as skipped/zero. A bare
-- sum(quantity) would let a NULL-quantity row vanish and a 0-quantity row
-- contribute 0, shrinking the denominator and inflating avg_sale_price (and
-- every downstream margin). unified_sales.quantity is NUMERIC NOT NULL
-- DEFAULT 1 today, so the NULL branch is defensive; the 0 branch is live.
--
-- coalesce(total_price, 0) is load-bearing for the same reason, on the
-- numerator side: unified_sales.total_price is NULLABLE, and the TS this
-- replaces summed `sale.total_price || 0`. A bare sum() returns NULL when every
-- row in a group has a NULL total_price (a manual sale with unit_price set but
-- no total), which would flip that item from "avg price 0" to "No sales data".
--
-- The inner join to active recipes on (restaurant_id, pos_item_name) bounds
-- the result to the count of distinct mapped pos_item_name values, so the
-- PostgREST 1000-row response cap cannot bite here even though the aggregate
-- itself scans every matching unified_sales row (no client-side truncation).
--
-- SECURITY INVOKER + no explicit membership check: RLS on unified_sales and
-- recipes (both already require user_restaurants membership / capability)
-- enforces tenant isolation regardless of the p_restaurant_id argument passed.
CREATE OR REPLACE FUNCTION public.get_recipe_sales_stats(p_restaurant_id UUID)
RETURNS TABLE (item_name TEXT, avg_sale_price NUMERIC)
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT us.item_name,
         SUM(COALESCE(us.total_price, 0)) / NULLIF(SUM(COALESCE(NULLIF(us.quantity, 0), 1)), 0)
  FROM unified_sales us
  JOIN recipes r
    ON r.restaurant_id = us.restaurant_id
   AND r.pos_item_name = us.item_name
   AND r.is_active
  WHERE us.restaurant_id = p_restaurant_id
    AND us.unit_price IS NOT NULL
  GROUP BY us.item_name;
$$;

-- Re-issued explicitly: CREATE OR REPLACE resets ACLs.
GRANT EXECUTE ON FUNCTION public.get_recipe_sales_stats(UUID) TO authenticated;
