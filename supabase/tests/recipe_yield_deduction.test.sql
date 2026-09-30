-- pgTAP tests for recipe yield deduction.
-- This file has the CHECK constraint boundary cases (design §4) and the
-- deduction math cases (design §9).

BEGIN;

SELECT plan(18);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients DISABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE prep_recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE production_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE production_run_ingredients DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

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

-- ============================================
-- Deduction math (design §9)
-- ============================================

-- Test 9: 100% product yield → deduction stays the quantity times count sold
INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-5', 'Full Yield Product', 100, 1.00, 100);

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active)
VALUES ('eeeeeeee-6666-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 'Full Yield Recipe', 'Full Yield Item', true);

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit)
VALUES ('eeeeeeee-7777-0000-0000-000000000001', 'eeeeeeee-6666-0000-0000-000000000001', 'eeeeeeee-5555-0000-0000-000000000001', 5, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    'eeeeeeee-1111-0000-0000-000000000001', 'Full Yield Item', 1, '2026-09-30', 'order-full-yield-001'
  )$$,
  'A 100% yield product deducts without error'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'eeeeeeee-5555-0000-0000-000000000001'),
  95.0::numeric,
  'A 100% yield product deducts the recipe quantity unchanged: 100 - 5 = 95'
);

-- Test 10: a NULL yield_pct deducts as 100% (COALESCE guard)
ALTER TABLE products ALTER COLUMN yield_pct DROP NOT NULL;

INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-6', 'Null Yield Product', 100, 1.00, NULL);

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active)
VALUES ('eeeeeeee-6666-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001', 'Null Yield Recipe', 'Null Yield Item', true);

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit)
VALUES ('eeeeeeee-7777-0000-0000-000000000002', 'eeeeeeee-6666-0000-0000-000000000002', 'eeeeeeee-5555-0000-0000-000000000002', 5, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    'eeeeeeee-1111-0000-0000-000000000001', 'Null Yield Item', 1, '2026-09-30', 'order-null-yield-001'
  )$$,
  'A NULL product yield_pct deducts without error'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'eeeeeeee-5555-0000-0000-000000000002'),
  95.0::numeric,
  'A NULL product yield_pct falls back to 100%: 100 - 5 = 95'
);

-- Test 11: 90% product yield → 5 sold units of quantity 1 deduct 5.5556
INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000003', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-7', '90pct Yield Product', 100, 1.00, 90);

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active)
VALUES ('eeeeeeee-6666-0000-0000-000000000003', 'eeeeeeee-1111-0000-0000-000000000001', '90pct Yield Recipe', '90pct Yield Item', true);

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit)
VALUES ('eeeeeeee-7777-0000-0000-000000000003', 'eeeeeeee-6666-0000-0000-000000000003', 'eeeeeeee-5555-0000-0000-000000000003', 1, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    'eeeeeeee-1111-0000-0000-000000000001', '90pct Yield Item', 5, '2026-09-30', 'order-90pct-yield-001'
  )$$,
  'A 90% yield product deducts without error'
);

SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'eeeeeeee-5555-0000-0000-000000000003') BETWEEN 94.4443 AND 94.4445,
  'A 90% yield product deducts 5.5556 for 5 sold units of 1: 100 - 5.5556 ~= 94.4444'
);

-- Test 12: a line override of 80% wins over the product yield of 90%
INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000004', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-8', 'Override Yield Product', 100, 1.00, 90);

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active)
VALUES ('eeeeeeee-6666-0000-0000-000000000004', 'eeeeeeee-1111-0000-0000-000000000001', 'Override Yield Recipe', 'Override Yield Item', true);

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit, yield_pct_override)
VALUES ('eeeeeeee-7777-0000-0000-000000000004', 'eeeeeeee-6666-0000-0000-000000000004', 'eeeeeeee-5555-0000-0000-000000000004', 1, 'oz', 80);

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    'eeeeeeee-1111-0000-0000-000000000001', 'Override Yield Item', 1, '2026-09-30', 'order-override-yield-001'
  )$$,
  'A line yield override deducts without error'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'eeeeeeee-5555-0000-0000-000000000004'),
  98.75::numeric,
  'The line override of 80% wins over the product yield of 90%: 100 - 1.25 = 98.75'
);

-- Test 13: the function signature keeps SECURITY DEFINER
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE proname = 'process_unified_inventory_deduction' LIMIT 1),
  'process_unified_inventory_deduction stays SECURITY DEFINER'
);

-- Test 14: a prep production run deducts with the product yield
SET LOCAL "request.jwt.claims" TO '{"sub": "eeeeeeee-9999-0000-0000-00000000000a", "role": "authenticated"}';
INSERT INTO auth.users (id, email)
VALUES ('eeeeeeee-9999-0000-0000-00000000000a', 'yield-prep-test@example.com')
ON CONFLICT (id) DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('eeeeeeee-9999-0000-0000-00000000000a', 'eeeeeeee-1111-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000005', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-9', 'Prep Yield Ingredient', 100, 1.00, 90);

INSERT INTO products (id, restaurant_id, sku, name, current_stock, cost_per_unit, yield_pct)
VALUES ('eeeeeeee-5555-0000-0000-000000000006', 'eeeeeeee-1111-0000-0000-000000000001', 'YD-10', 'Prep Yield Output', 0, 0, 100);

INSERT INTO recipes (id, restaurant_id, name, is_active)
VALUES ('eeeeeeee-6666-0000-0000-000000000005', 'eeeeeeee-1111-0000-0000-000000000001', 'Prep Yield Recipe', true);

INSERT INTO recipe_ingredients (id, recipe_id, product_id, quantity, unit)
VALUES ('eeeeeeee-7777-0000-0000-000000000005', 'eeeeeeee-6666-0000-0000-000000000005', 'eeeeeeee-5555-0000-0000-000000000005', 1, 'oz');

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('eeeeeeee-8888-0000-0000-000000000001', 'eeeeeeee-1111-0000-0000-000000000001', 'eeeeeeee-6666-0000-0000-000000000005', 'Prep Yield Recipe', 1, 'unit', 'eeeeeeee-5555-0000-0000-000000000006');

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('eeeeeeee-8888-0000-0000-000000000002', 'eeeeeeee-1111-0000-0000-000000000001', 'eeeeeeee-8888-0000-0000-000000000001', 'in_progress', 1, 'unit', NULL);

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('eeeeeeee-8888-0000-0000-000000000003', 'eeeeeeee-8888-0000-0000-000000000002', 'eeeeeeee-5555-0000-0000-000000000005', 1, 1, 'oz');

SELECT complete_production_run('eeeeeeee-8888-0000-0000-000000000002', 1, 'unit', '[]'::jsonb);

SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'eeeeeeee-5555-0000-0000-000000000005') BETWEEN 98.8888 AND 98.8890,
  'A prep production run deducts with the product yield: 100 - (1 / 0.9) ~= 98.8889'
);

SELECT * FROM finish();

ROLLBACK;
