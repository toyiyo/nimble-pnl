-- get_recipe_sales_stats: SECURITY DEFINER with an explicit tenant check.
-- Design: docs/superpowers/specs/2026-10-06-recipe-sales-stats-rls-timeout-design.md
--
-- Why: the earlier version (20260727120000_get_recipe_sales_stats.sql) is
-- SECURITY INVOKER with SET search_path, so Postgres does not inline it and
-- plans p_restaurant_id as $1 (a generic plan). In the generic plan, the
-- unified_sales RLS EXISTS subplan is correlated and runs one time for each
-- sales row. For a tenant with 68,276 sales rows this cost 546,109 buffers
-- and 3.2 s on a warm cache, and the call hit the 8 s statement_timeout
-- (57014) for authenticated. As a definer owned by postgres (rolbypassrls),
-- the body has no RLS subplan: 3,202 buffers, about 21 ms.
--
-- The definer bypasses RLS, so the explicit check
-- public.user_has_capability(p_restaurant_id, 'view:recipes') gives tenant
-- isolation. It gives the same access set as the old RLS pair: the recipes
-- policy is user_has_capability(restaurant_id, 'view:recipes'), and that
-- function returns false when the caller has no user_restaurants row. The
-- check has constant arguments and is STABLE, so the planner runs it one time
-- (One-Time Filter), not for each row. A caller without the capability gets
-- zero rows, not an error: useRecipes also runs on /pos-sales, where a
-- collaborator with the sales area but not the recipes area must not see an
-- error toast.
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
CREATE OR REPLACE FUNCTION public.get_recipe_sales_stats(p_restaurant_id UUID)
RETURNS TABLE (item_name TEXT, avg_sale_price NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT us.item_name,
         SUM(COALESCE(us.total_price, 0)) / NULLIF(SUM(COALESCE(NULLIF(us.quantity, 0), 1)), 0)
  FROM public.unified_sales us
  JOIN public.recipes r
    ON r.restaurant_id = us.restaurant_id
   AND r.pos_item_name = us.item_name
   AND r.is_active
  WHERE us.restaurant_id = p_restaurant_id
    AND us.unit_price IS NOT NULL
    AND public.user_has_capability(p_restaurant_id, 'view:recipes')
  GROUP BY us.item_name;
$$;

-- Postgres and the Supabase default privileges give EXECUTE to PUBLIC and
-- anon. Only signed-in users call this function.
REVOKE ALL ON FUNCTION public.get_recipe_sales_stats(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_recipe_sales_stats(UUID) TO authenticated;
