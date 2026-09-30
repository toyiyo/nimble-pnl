-- pgTAP tests for the recipe yield pct migration
-- Tests: new columns exist, defaults, and NOT VALID CHECK constraints
-- reject bad values on new writes.

BEGIN;

SELECT plan(8);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name)
VALUES ('dddddddd-1111-0000-0000-000000000001', 'Yield Pct Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Test 1-3: products.yield_pct and products.waste_reason exist
-- ============================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'yield_pct'
  ),
  'products has a yield_pct column'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products'
      AND column_name = 'waste_reason'
  ),
  'products has a waste_reason column'
);

INSERT INTO products (id, restaurant_id, sku, name)
VALUES ('dddddddd-2222-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', 'YP-1', 'Yield Test Product');

SELECT is(
  (SELECT yield_pct FROM products WHERE id = 'dddddddd-2222-0000-0000-000000000001'),
  100.00,
  'products.yield_pct defaults to 100'
);

-- ============================================
-- Test 4: products_yield_pct_range rejects an out-of-range value
-- (NOT VALID still applies to new writes)
-- ============================================

SELECT throws_ok(
  $$INSERT INTO products (id, restaurant_id, sku, name, yield_pct)
    VALUES ('dddddddd-2222-0000-0000-000000000002', 'dddddddd-1111-0000-0000-000000000001', 'YP-2', 'Bad Yield Product', 40)$$,
  '23514',
  NULL,
  'products_yield_pct_range rejects yield_pct below 50'
);

-- ============================================
-- Test 5: products_waste_reason_len rejects a too-long reason
-- ============================================

SELECT throws_ok(
  format(
    $$INSERT INTO products (id, restaurant_id, sku, name, waste_reason)
      VALUES ('dddddddd-2222-0000-0000-000000000003', 'dddddddd-1111-0000-0000-000000000001', 'YP-3', 'Long Reason Product', %L)$$,
    repeat('x', 121)
  ),
  '23514',
  NULL,
  'products_waste_reason_len rejects waste_reason over 120 chars'
);

-- ============================================
-- Test 6-8: recipe_ingredients.yield_pct_override exists, defaults NULL,
-- and its range constraint rejects an out-of-range value
-- ============================================

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'recipe_ingredients'
      AND column_name = 'yield_pct_override'
  ),
  'recipe_ingredients has a yield_pct_override column'
);

INSERT INTO recipes (id, restaurant_id, name)
VALUES ('dddddddd-3333-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', 'Yield Test Recipe');

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit)
VALUES (
  'dddddddd-4444-0000-0000-000000000001',
  'dddddddd-3333-0000-0000-000000000001',
  'dddddddd-2222-0000-0000-000000000001',
  1,
  'oz'
);

SELECT is(
  (SELECT yield_pct_override FROM recipe_ingredients WHERE id = 'dddddddd-4444-0000-0000-000000000001'),
  NULL,
  'recipe_ingredients.yield_pct_override defaults to NULL'
);

SELECT throws_ok(
  $$INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
    VALUES (
      'dddddddd-4444-0000-0000-000000000002',
      'dddddddd-3333-0000-0000-000000000001',
      'dddddddd-2222-0000-0000-000000000001',
      1,
      'oz',
      101
    )$$,
  '23514',
  NULL,
  'recipe_ingredients_yield_override_range rejects an override above 100'
);

SELECT * FROM finish();

ROLLBACK;
