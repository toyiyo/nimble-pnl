-- Tests get_inventory_valuation (cluster 5, inventory aggregate over products).
-- The RPC runs as SECURITY INVOKER: RLS on products scopes the caller, so a
-- non-member simply sees one row of zeros for a foreign restaurant, not an
-- error and not an empty result (COUNT/SUM without GROUP BY always return a
-- row).
--
-- Assertions:
--   1. total_value sums current_stock * cost_per_unit across a 2-product
--      fixture.
--   2. item_count counts the rows in the 2-product fixture.
--   3. low_stock_count uses current_stock <= COALESCE(par_level_min, 0): a
--      product with par_level_min NULL and current_stock 0 counts as low
--      stock; a product with stock 5 does not.
--   4. An empty restaurant (no products) returns one row of zeros, not an
--      empty result.
--   5. Tenancy: a non-member gets one row of zeros for a foreign restaurant
--      that holds real product data (RLS hides the rows; the aggregate
--      still returns a row).

BEGIN;
SELECT plan(5);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000284'::uuid, 'inv-valuation-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000280'::uuid, 'Inventory Valuation Test Restaurant'),
  ('00000000-0000-0000-0000-000000000281'::uuid, 'Inventory Valuation Foreign Restaurant'),
  ('00000000-0000-0000-0000-000000000282'::uuid, 'Inventory Valuation Empty Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs to the primary and the empty restaurant, not the
-- foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000284'::uuid,
   '00000000-0000-0000-0000-000000000280'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000000284'::uuid,
   '00000000-0000-0000-0000-000000000282'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Primary restaurant: two products.
--   - Product A: stock 5, cost 10.00, par_level_min NULL -> not low stock
--     (5 <= COALESCE(NULL, 0) is false).
--   - Product B: stock 0, cost 3.50, par_level_min NULL -> low stock
--     (0 <= COALESCE(NULL, 0) is true).
-- total_value = 5*10.00 + 0*3.50 = 50.00, item_count = 2, low_stock_count = 1.
INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, par_level_min) VALUES
  ('00000000-0000-0000-0000-000000000285'::uuid,
   '00000000-0000-0000-0000-000000000280'::uuid, 'INV-VAL-SKU-1', 'Inventory Valuation Product A',
   5, 10.00, NULL),
  ('00000000-0000-0000-0000-000000000286'::uuid,
   '00000000-0000-0000-0000-000000000280'::uuid, 'INV-VAL-SKU-2', 'Inventory Valuation Product B',
   0, 3.50, NULL)
ON CONFLICT (id) DO UPDATE SET
  current_stock = EXCLUDED.current_stock,
  cost_per_unit = EXCLUDED.cost_per_unit,
  par_level_min = EXCLUDED.par_level_min;

-- Foreign restaurant: real product data a non-member must not see.
INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, par_level_min) VALUES
  ('00000000-0000-0000-0000-000000000287'::uuid,
   '00000000-0000-0000-0000-000000000281'::uuid, 'INV-VAL-SKU-3', 'Inventory Valuation Foreign Product',
   20, 2.00, NULL)
ON CONFLICT (id) DO UPDATE SET
  current_stock = EXCLUDED.current_stock,
  cost_per_unit = EXCLUDED.cost_per_unit,
  par_level_min = EXCLUDED.par_level_min;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000284","role":"authenticated"}';

-- Test 1: total_value sums current_stock * cost_per_unit across the fixture.
SELECT results_eq(
  $$ SELECT total_value FROM get_inventory_valuation(
       '00000000-0000-0000-0000-000000000280'::uuid) $$,
  $$ VALUES (50.00::numeric) $$,
  'total_value sums current_stock * cost_per_unit across the 2-product fixture'
);

-- Test 2: item_count counts the rows in the 2-product fixture.
SELECT results_eq(
  $$ SELECT item_count FROM get_inventory_valuation(
       '00000000-0000-0000-0000-000000000280'::uuid) $$,
  $$ VALUES (2::bigint) $$,
  'item_count counts the rows in the 2-product fixture'
);

-- Test 3: low_stock_count treats a NULL par_level_min as 0 in the
-- comparison — stock 0 counts as low stock, stock 5 does not.
SELECT results_eq(
  $$ SELECT low_stock_count FROM get_inventory_valuation(
       '00000000-0000-0000-0000-000000000280'::uuid) $$,
  $$ VALUES (1::bigint) $$,
  'low_stock_count counts a NULL-par product at stock 0 but not one at stock 5'
);

-- Test 4: an empty restaurant returns one row of zeros, not an empty result.
SELECT results_eq(
  $$ SELECT total_value, item_count, low_stock_count FROM get_inventory_valuation(
       '00000000-0000-0000-0000-000000000282'::uuid) $$,
  $$ VALUES (0::numeric, 0::bigint, 0::bigint) $$,
  'An empty restaurant returns one row of zeros, not an empty result'
);

-- Test 5: tenancy. A non-member gets one row of zeros for a foreign
-- restaurant that holds real product data — RLS hides the rows, but the
-- aggregate still returns a row.
SELECT results_eq(
  $$ SELECT total_value, item_count, low_stock_count FROM get_inventory_valuation(
       '00000000-0000-0000-0000-000000000281'::uuid) $$,
  $$ VALUES (0::numeric, 0::bigint, 0::bigint) $$,
  'A non-member gets one row of zeros for a foreign restaurant with real product data'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
