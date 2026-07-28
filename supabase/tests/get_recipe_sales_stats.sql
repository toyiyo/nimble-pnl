-- pgTAP tests for get_recipe_sales_stats(p_restaurant_id)
-- Design: docs/superpowers/specs/2026-07-27-recipes-page-load-perf-design.md §3.5
--
-- Fixture restaurant aa000000-0000-0000-0000-000000000001 ("Recipe Stats Test
-- Restaurant A"), owned by user …a1. A second restaurant
-- aa000000-0000-0000-0000-000000000002 ("...Restaurant B") with its own owner
-- …a2 (NOT a member of Restaurant A) exists solely to prove RLS-driven
-- cross-tenant isolation (test 6) — the function takes p_restaurant_id as a
-- plain parameter with no explicit membership check of its own (per design:
-- SECURITY INVOKER, relying entirely on unified_sales/recipes RLS).
--
-- Denominator predicate under test: sum(total_price) / sum(coalesce(nullif(quantity,0),1))
-- mirrors the TS it replaces (`sale.quantity || 1`) exactly — NULL and 0
-- quantity rows both count as 1 in the denominator, never as skipped/zero.
--
-- NOTE on the plan's "row with quantity = NULL" case: unified_sales.quantity is
-- `NUMERIC NOT NULL DEFAULT 1` (base migration 20250925125415, never relaxed —
-- confirmed against the live local schema), so that fixture is not constructible;
-- a NULL there fails at INSERT, not the RPC. Mirrors the documented precedent in
-- get_sales_trends.sql for external_order_id. The NULL-handling half of the
-- formula is instead pinned as a standalone expression assertion (test 2 below);
-- the live-fixture half (quantity = 0, fully constructible) is tested end-to-end
-- through the RPC (test 3).
BEGIN;
SELECT plan(10);

-- ============================================================
-- Setup: two restaurants, two owners, RLS enforced via role switch
-- ============================================================
SET LOCAL role TO postgres;

INSERT INTO auth.users (id, email) VALUES
  ('aa000000-0000-0000-0000-0000000000a1'::uuid, 'recipe-stats-owner-a@example.com'),
  ('aa000000-0000-0000-0000-0000000000a2'::uuid, 'recipe-stats-owner-b@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('aa000000-0000-0000-0000-000000000001'::uuid, 'Recipe Stats Test Restaurant A', '1 Stats Ave', '555-0101'),
  ('aa000000-0000-0000-0000-000000000002'::uuid, 'Recipe Stats Test Restaurant B', '2 Stats Ave', '555-0102')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('aa000000-0000-0000-0000-0000000000a1'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'owner'),
  ('aa000000-0000-0000-0000-0000000000a2'::uuid, 'aa000000-0000-0000-0000-000000000002'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ============================================================
-- Recipes (Restaurant A). "Fries" is inactive on purpose (test e).
-- ============================================================
INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('aa000000-0000-0000-0000-0000000000b1'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'Burger Recipe', 'Burger', true),
  ('aa000000-0000-0000-0000-0000000000b2'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'Soda Recipe', 'Soda', true),
  ('aa000000-0000-0000-0000-0000000000b3'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'Fries Recipe', 'Fries', false),
  ('aa000000-0000-0000-0000-0000000000b4'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'Taco Recipe', 'Taco', true)
ON CONFLICT (id) DO UPDATE SET pos_item_name = EXCLUDED.pos_item_name, is_active = EXCLUDED.is_active;

-- ============================================================
-- Sales rows (Restaurant A)
-- ============================================================

-- Burger: general avg formula check (test a).
-- sum(total_price) = 10 + 15 + 5 = 30; sum(quantity) = 2 + 3 + 1 = 6 -> avg = 5.0
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date) VALUES
  ('aa000000-0000-0000-0000-0000000000c1'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'manual', 'rs-1', 'Burger', 2, 10.00, 5.00, '2026-07-01'),
  ('aa000000-0000-0000-0000-0000000000c2'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'manual', 'rs-2', 'Burger', 3, 15.00, 5.00, '2026-07-01'),
  ('aa000000-0000-0000-0000-0000000000c3'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'manual', 'rs-3', 'Burger', 1, 5.00, 5.00, '2026-07-01')
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, unit_price = EXCLUDED.unit_price;

-- Soda: 0 quantity counts as 1 in the denominator (test c; live-fixture half of
-- the NULL/0 formula — see the NULL note above for why NULL can't be fixtured).
-- sum(total_price) = 3.00; denom = coalesce(nullif(0,0),1) = 1 -> avg = 3.0
-- (A bare sum(quantity) would divide by 0 -> NULL: NOT 3.0.)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date) VALUES
  ('aa000000-0000-0000-0000-0000000000c4'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'manual', 'rs-4', 'Soda', 0, 3.00, 3.00, '2026-07-01')
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, unit_price = EXCLUDED.unit_price;

-- Fries: recipe is inactive -> must not appear in results at all (test e),
-- even though there is a priced sales row for it.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date) VALUES
  ('aa000000-0000-0000-0000-000000000006'::uuid, 'aa000000-0000-0000-0000-000000000001'::uuid, 'manual', 'rs-6', 'Fries', 1, 100.00, 100.00, '2026-07-01')
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, unit_price = EXCLUDED.unit_price;

-- Taco: 1500 rows (> the PostgREST 1000-row default cap) to prove the RPC
-- aggregates server-side over ALL rows, not a truncated sample (test d).
-- 1000 rows @ total_price 1.00 + 500 rows @ total_price 4.00, quantity=1 throughout.
-- sum(total_price) = 1000*1.00 + 500*4.00 = 3000.00; sum(quantity) = 1500 -> avg = 2.0
-- If truncated to any arbitrary 1000-row slice this would not equal 2.0.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, unit_price, sale_date)
SELECT
  ('aa000001-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
  'aa000000-0000-0000-0000-000000000001'::uuid,
  'manual',
  'rs-taco-' || g::text,
  'Taco',
  1,
  CASE WHEN g <= 1000 THEN 1.00 ELSE 4.00 END,
  CASE WHEN g <= 1000 THEN 1.00 ELSE 4.00 END,
  '2026-07-01'::date
FROM generate_series(1, 1500) AS g
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, unit_price = EXCLUDED.unit_price;

-- ============================================================
-- Switch to Restaurant A's owner for the positive-path assertions
-- ============================================================
SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "aa000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

-- Test 1 (a): Burger average matches sum(total_price)/sum(quantity)
SELECT is(
  (SELECT avg_sale_price FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid) WHERE item_name = 'Burger'),
  5.00::numeric,
  'Burger avg_sale_price = sum(total_price)/sum(quantity)'
);

-- Test 2 (b, expression-level): NULL quantity would resolve to 1 in the
-- denominator per the RPC's own formula (coalesce(nullif(quantity,0),1)) --
-- pinned as a standalone expression since it cannot be fixtured end-to-end
-- (see NOTE above). This is the exact expression `get_recipe_sales_stats`'s
-- migration must use in its GROUP BY denominator.
SELECT is(
  coalesce(nullif(NULL::numeric, 0), 1),
  1::numeric,
  'coalesce(nullif(quantity,0),1) resolves NULL quantity to 1 (formula-level, see NOTE)'
);

-- Test 3 (c): Soda average treats 0 quantity as 1 (live fixture)
SELECT is(
  (SELECT avg_sale_price FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid) WHERE item_name = 'Soda'),
  3.00::numeric,
  'Soda avg_sale_price treats 0 quantity as 1 in the denominator'
);

-- Test 4 (d): Taco average is computed over all 1500 rows, not a 1000-row sample
SELECT is(
  (SELECT avg_sale_price FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid) WHERE item_name = 'Taco'),
  2.00::numeric,
  'Taco avg_sale_price aggregates over all 1500 rows (no 1000-row truncation)'
);

-- Test 5 (e): inactive recipe's pos_item_name (Fries) does not appear
SELECT is(
  (SELECT COUNT(*)::int FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid) WHERE item_name = 'Fries'),
  0,
  'Fries (inactive recipe) does not appear in results'
);

-- Test 6: result set is exactly the 3 active, mapped, priced items
SELECT is(
  (SELECT COUNT(*)::int FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid)),
  3,
  'Result set contains exactly one row per active mapped item name (Burger, Soda, Taco)'
);

-- ============================================================
-- Test 7 (f): a caller from another restaurant gets zero rows, even though
-- p_restaurant_id is a valid id with real data. RLS on unified_sales/recipes
-- (not an explicit check in the function body) is what enforces this.
-- ============================================================
SET LOCAL "request.jwt.claims" TO '{"sub": "aa000000-0000-0000-0000-0000000000a2", "role": "authenticated"}';

SELECT is(
  (SELECT COUNT(*)::int FROM get_recipe_sales_stats('aa000000-0000-0000-0000-000000000001'::uuid)),
  0,
  'A caller with no membership in Restaurant A gets zero rows (RLS-enforced isolation)'
);

-- ============================================================
-- Sanity: function metadata matches design §3.5 exactly
-- ============================================================
SELECT is(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'get_recipe_sales_stats' AND pronamespace = 'public'::regnamespace),
  false,
  'get_recipe_sales_stats is SECURITY INVOKER (prosecdef = false)'
);

SELECT is(
  (SELECT provolatile FROM pg_proc WHERE proname = 'get_recipe_sales_stats' AND pronamespace = 'public'::regnamespace),
  's',
  'get_recipe_sales_stats is STABLE'
);

SELECT is(
  (SELECT lanname FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
   WHERE p.proname = 'get_recipe_sales_stats' AND p.pronamespace = 'public'::regnamespace),
  'sql',
  'get_recipe_sales_stats is LANGUAGE SQL'
);

SELECT * FROM finish();
ROLLBACK;
