-- pgTAP tests for recipe yield deduction.
-- This file starts with the CHECK constraint boundary cases (design §4).
-- A later task extends it with the deduction math cases (design §9).

BEGIN;

SELECT plan(8);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name)
VALUES ('eeeeeeee-1111-0000-0000-000000000001', 'Yield Deduction Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- products.yield_pct: 49 and 101 fail, 50 and 100 pass
-- ============================================

SELECT throws_ok(
  $$INSERT INTO products (id, restaurant_id, sku, name, yield_pct)
    VALUES ('eeeeeeee-2222-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-1', 'Yield 49 Product', 49)$$,
  '23514',
  NULL,
  'products_yield_pct_range rejects yield_pct of 49'
);

SELECT throws_ok(
  $$INSERT INTO products (id, restaurant_id, sku, name, yield_pct)
    VALUES ('eeeeeeee-2222-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-2', 'Yield 101 Product', 101)$$,
  '23514',
  NULL,
  'products_yield_pct_range rejects yield_pct of 101'
);

SELECT lives_ok(
  $$INSERT INTO products (id, restaurant_id, sku, name, yield_pct)
    VALUES ('eeeeeeee-2222-0000-0000-000000000003', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-3', 'Yield 50 Product', 50)$$,
  'products_yield_pct_range accepts yield_pct of 50'
);

SELECT lives_ok(
  $$INSERT INTO products (id, restaurant_id, sku, name, yield_pct)
    VALUES ('eeeeeeee-2222-0000-0000-000000000004', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-4', 'Yield 100 Product', 100)$$,
  'products_yield_pct_range accepts yield_pct of 100'
);

-- ============================================
-- recipe_ingredients.yield_pct_override: 49 and 101 fail, 50 and 100 pass
-- ============================================

INSERT INTO recipes (id, restaurant_id, name)
VALUES ('eeeeeeee-3333-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 'Yield Deduction Test Recipe');

SELECT throws_ok(
  $$INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
    VALUES (
      'eeeeeeee-4444-0000-0000-000000000001',
      'eeeeeeee-3333-0000-0000-000000000001',
      'eeeeeeee-2222-0000-0000-000000000004',
      1,
      'oz',
      49
    )$$,
  '23514',
  NULL,
  'recipe_ingredients_yield_override_range rejects an override of 49'
);

SELECT throws_ok(
  $$INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
    VALUES (
      'eeeeeeee-4444-0000-0000-000000000002',
      'eeeeeeee-3333-0000-0000-000000000001',
      'eeeeeeee-2222-0000-0000-000000000004',
      1,
      'oz',
      101
    )$$,
  '23514',
  NULL,
  'recipe_ingredients_yield_override_range rejects an override of 101'
);

SELECT lives_ok(
  $$INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
    VALUES (
      'eeeeeeee-4444-0000-0000-000000000003',
      'eeeeeeee-3333-0000-0000-000000000001',
      'eeeeeeee-2222-0000-0000-000000000004',
      1,
      'oz',
      50
    )$$,
  'recipe_ingredients_yield_override_range accepts an override of 50'
);

SELECT lives_ok(
  $$INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
    VALUES (
      'eeeeeeee-4444-0000-0000-000000000004',
      'eeeeeeee-3333-0000-0000-000000000001',
      'eeeeeeee-2222-0000-0000-000000000004',
      1,
      'oz',
      100
    )$$,
  'recipe_ingredients_yield_override_range accepts an override of 100'
);

SELECT * FROM finish();

ROLLBACK;
