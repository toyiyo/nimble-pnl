-- Comprehensive tests for inventory deduction conversions
-- Note: This test suite validates conversion logic in process_unified_inventory_deduction
BEGIN;
SELECT plan(30);

-- Setup: Create test restaurant (skip user setup as it's handled by test framework)
INSERT INTO restaurants (id, name) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- TEST CATEGORY 1: DIRECT UNIT MATCH (No Conversion)
-- ============================================================

-- Test 1: Recipe unit matches purchase unit exactly
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Direct Match Product', 'DIRECT-001', 'kg', 10, 5.00, 1, 'kg')
ON CONFLICT (id) DO UPDATE SET current_stock = 10;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Direct Match Recipe', 'Direct Match Item', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 0.5, 'kg');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Direct Match Item',
    2,
    '2025-01-15',
    'order-direct-001'
  )$$,
  'Direct unit match deduction should succeed'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000001'),
  9.0::numeric,
  'Direct match: 10 kg - (0.5 kg * 2) = 9 kg'
);

-- ============================================================
-- TEST CATEGORY 2: CONTAINER UNIT CONVERSIONS (bottle, jar, can)
-- ============================================================

-- Test 2: Bottle (750ml) with oz recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Vodka Bottle', 'VODKA-001', 'bottle', 12, 25.00, 750, 'ml')
ON CONFLICT (id) DO UPDATE SET current_stock = 12, cost_per_unit = 25.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Vodka Cocktail', 'Vodka Cocktail', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 1.5, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Vodka Cocktail',
    10,
    '2025-01-15',
    'order-vodka-001'
  )$$,
  'Bottle to oz conversion should succeed'
);

-- 1.5 oz * 10 = 15 oz = 443.6025 ml
-- 443.6025 ml / 750 ml = 0.5915 bottles
-- 12 - 0.5915 ≈ 11.41 bottles
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000002') BETWEEN 11.40 AND 11.42,
  'Bottle-oz conversion: 12 - (15 oz / 750ml) ≈ 11.41 bottles'
);

-- Test 3: Container with cup recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Milk Container', 'MILK-001', 'container', 20, 4.50, 1, 'L')
ON CONFLICT (id) DO UPDATE SET current_stock = 20, cost_per_unit = 4.50;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Latte', 'Latte', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 0.5, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Latte',
    20,
    '2025-01-15',
    'order-latte-001'
  )$$,
  'Container to cup conversion should succeed'
);

-- 0.5 cup * 20 = 10 cups = 2365.88 ml
-- 2365.88 ml / 1000 ml = 2.36588 containers
-- 20 - 2.36588 ≈ 17.63 containers
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000003') BETWEEN 17.62 AND 17.65,
  'Container-cup conversion: 20 - (10 cups / 1L) ≈ 17.63 containers'
);

-- Test 4: Jar with tbsp recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Olive Oil Jar', 'OIL-001', 'jar', 15, 12.00, 500, 'ml')
ON CONFLICT (id) DO UPDATE SET current_stock = 15, cost_per_unit = 12.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222', 'Salad', 'Salad', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 2, 'tbsp');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Salad',
    15,
    '2025-01-15',
    'order-salad-001'
  )$$,
  'Jar to tbsp conversion should succeed'
);

-- 2 tbsp * 15 = 30 tbsp = 443.604 ml
-- 443.604 ml / 500 ml = 0.887 jars
-- 15 - 0.887 ≈ 14.11 jars
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000004') BETWEEN 14.10 AND 14.13,
  'Jar-tbsp conversion: 15 - (30 tbsp / 500ml) ≈ 14.11 jars'
);

-- Test 5: Can with tsp recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Tomato Paste Can', 'PASTE-001', 'can', 30, 2.50, 170, 'ml')
ON CONFLICT (id) DO UPDATE SET current_stock = 30, cost_per_unit = 2.50;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Pasta Sauce', 'Pasta Sauce', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 3, 'tsp');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Pasta Sauce',
    12,
    '2025-01-15',
    'order-pasta-001'
  )$$,
  'Can to tsp conversion should succeed'
);

-- 3 tsp * 12 = 36 tsp = 177.44 ml
-- 177.44 ml / 170 ml = 1.044 cans
-- 30 - 1.044 ≈ 28.96 cans
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000005') BETWEEN 28.95 AND 28.97,
  'Can-tsp conversion: 30 - (36 tsp / 170ml) ≈ 28.96 cans'
);

-- ============================================================
-- TEST CATEGORY 3: WEIGHT-BASED CONVERSIONS (bag, box, lb, kg)
-- ============================================================

-- Test 6: Bag with g recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'Flour Bag', 'FLOUR-001', 'bag', 8, 15.00, 5, 'kg')
ON CONFLICT (id) DO UPDATE SET current_stock = 8, cost_per_unit = 15.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000006', '22222222-2222-2222-2222-222222222222', 'Bread', 'Bread', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 300, 'g');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Bread',
    10,
    '2025-01-15',
    'order-bread-001'
  )$$,
  'Bag to g conversion should succeed'
);

-- 300 g * 10 = 3000 g = 3 kg
-- 3 kg / 5 kg = 0.6 bags
-- 8 - 0.6 = 7.4 bags
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000006'),
  7.4::numeric,
  'Bag-g conversion: 8 - (3000g / 5kg) = 7.4 bags'
);

-- Test 7: Box with oz (weight) recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'Pasta Box', 'PASTA-001', 'box', 25, 3.50, 1, 'lb')
ON CONFLICT (id) DO UPDATE SET current_stock = 25, cost_per_unit = 3.50;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000007', '22222222-2222-2222-2222-222222222222', 'Spaghetti', 'Spaghetti', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000007', 4, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Spaghetti',
    20,
    '2025-01-15',
    'order-spaghetti-001'
  )$$,
  'Box to oz conversion should succeed'
);

-- 4 oz * 20 = 80 oz = 2267.96 g
-- 2267.96 g / 453.592 g = 5 lb
-- 5 lb / 1 lb = 5 boxes
-- 25 - 5 = 20 boxes
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000007'),
  20.0::numeric,
  'Box-oz conversion: 25 - (80oz / 1lb) = 20 boxes'
);

-- Test 8: lb purchase with kg recipe unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'Ground Beef', 'BEEF-001', 'lb', 50, 8.00, 1, 'lb')
ON CONFLICT (id) DO UPDATE SET current_stock = 50, cost_per_unit = 8.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000008', '22222222-2222-2222-2222-222222222222', 'Burger', 'Burger', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000008', 0.15, 'kg');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Burger',
    30,
    '2025-01-15',
    'order-burger-001'
  )$$,
  'lb to kg conversion should succeed'
);

-- 0.15 kg * 30 = 4.5 kg = 9.92 lb
-- 50 - 9.92 ≈ 40.08 lb
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000008') BETWEEN 40.07 AND 40.09,
  'lb-kg conversion: 50 - (4.5kg to lb) ≈ 40.08 lb'
);

-- ============================================================
-- TEST CATEGORY 4: PRODUCT-SPECIFIC CONVERSIONS
-- ============================================================

-- Test 9: Rice - cup to g conversion
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'White Rice', 'RICE-001', 'bag', 10, 20.00, 10, 'kg')
ON CONFLICT (id) DO UPDATE SET current_stock = 10, cost_per_unit = 20.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222', 'Fried Rice', 'Fried Rice', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000009', 2, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Fried Rice',
    15,
    '2025-01-15',
    'order-rice-001'
  )$$,
  'Rice cup to g conversion should succeed'
);

-- 2 cups * 15 = 30 cups
-- 30 cups * 185g/cup = 5550 g = 5.55 kg
-- 5.55 kg / 10 kg = 0.555 bags
-- 10 - 0.555 = 9.445 bags
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000009') BETWEEN 9.44 AND 9.46,
  'Rice cup conversion: 10 - (30 cups * 185g / 10kg) ≈ 9.445 bags'
);

-- Test 10: Flour - cup to g conversion
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'All Purpose Flour', 'FLOUR-002', 'bag', 12, 18.00, 5, 'kg')
ON CONFLICT (id) DO UPDATE SET current_stock = 12, cost_per_unit = 18.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Pizza Dough', 'Pizza Dough', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000a', 'a0000000-0000-0000-0000-00000000000a', 3, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Pizza Dough',
    8,
    '2025-01-15',
    'order-pizza-001'
  )$$,
  'Flour cup to g conversion should succeed'
);

-- 3 cups * 8 = 24 cups
-- 24 cups * 120g/cup = 2880 g = 2.88 kg
-- 2.88 kg / 5 kg = 0.576 bags
-- 12 - 0.576 = 11.424 bags
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000a') BETWEEN 11.42 AND 11.43,
  'Flour cup conversion: 12 - (24 cups * 120g / 5kg) ≈ 11.424 bags'
);

-- Test 11: Sugar - cup to g conversion
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Granulated Sugar', 'SUGAR-001', 'bag', 15, 12.00, 2, 'kg')
ON CONFLICT (id) DO UPDATE SET current_stock = 15, cost_per_unit = 12.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Cookies', 'Cookies', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-00000000000b', 1.5, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Cookies',
    20,
    '2025-01-15',
    'order-cookies-001'
  )$$,
  'Sugar cup to g conversion should succeed'
);

-- 1.5 cups * 20 = 30 cups
-- 30 cups * 200g/cup = 6000 g = 6 kg
-- 6 kg / 2 kg = 3 bags
-- 15 - 3 = 12 bags
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000b'),
  12.0::numeric,
  'Sugar cup conversion: 15 - (30 cups * 200g / 2kg) = 12 bags'
);

-- Test 12: Butter - cup to g conversion
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Unsalted Butter', 'BUTTER-001', 'box', 20, 5.00, 1, 'lb')
ON CONFLICT (id) DO UPDATE SET current_stock = 20, cost_per_unit = 5.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222222', 'Croissants', 'Croissants', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000c', 'a0000000-0000-0000-0000-00000000000c', 0.5, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Croissants',
    12,
    '2025-01-15',
    'order-croissant-001'
  )$$,
  'Butter cup to g conversion should succeed'
);

-- 0.5 cups * 12 = 6 cups
-- 6 cups * 227g/cup = 1362 g = 1.362 kg
-- 1.362 kg / 0.453592 kg = 3.002 lb
-- 20 - 3.002 ≈ 17 lb (approximately)
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000c') BETWEEN 16.99 AND 17.01,
  'Butter cup conversion: 20 - (6 cups * 227g / 1lb) ≈ 17 lb'
);

-- ============================================================
-- TEST CATEGORY 5: STANDARD VOLUME CONVERSIONS
-- ============================================================

-- Test 13: oz to ml (standard volume conversion)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Simple Syrup', 'SYRUP-001', 'ml', 5000, 0.01, 1, 'ml')
ON CONFLICT (id) DO UPDATE SET current_stock = 5000, cost_per_unit = 0.01;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000d', '22222222-2222-2222-2222-222222222222', 'Sweet Tea', 'Sweet Tea', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000d', 'a0000000-0000-0000-0000-00000000000d', 2, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Sweet Tea',
    25,
    '2025-01-15',
    'order-tea-001'
  )$$,
  'oz to ml standard conversion should succeed'
);

-- 2 oz * 25 = 50 oz
-- 50 oz * 29.5735 ml/oz = 1478.675 ml
-- 5000 - 1478.675 = 3521.325 ml
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000d') BETWEEN 3521 AND 3522,
  'oz-ml conversion: 5000 - (50 oz * 29.5735) ≈ 3521.325 ml'
);

-- Test 14: cup to tbsp (standard volume conversion)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'Soy Sauce', 'SOY-001', 'tbsp', 1000, 0.05, 1, 'tbsp')
ON CONFLICT (id) DO UPDATE SET current_stock = 1000, cost_per_unit = 0.05;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000e', '22222222-2222-2222-2222-222222222222', 'Stir Fry', 'Stir Fry', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000e', 'a0000000-0000-0000-0000-00000000000e', 0.25, 'cup');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Stir Fry',
    10,
    '2025-01-15',
    'order-stirfry-001'
  )$$,
  'cup to tbsp standard conversion should succeed'
);

-- 0.25 cups * 10 = 2.5 cups
-- 2.5 cups * 16 tbsp/cup = 40 tbsp
-- 1000 - 40 = 960 tbsp
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000e'),
  960.0::numeric,
  'cup-tbsp conversion: 1000 - (2.5 cups * 16) = 960 tbsp'
);

-- Test 15: L to gal (standard volume conversion)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-00000000000f', '22222222-2222-2222-2222-222222222222', 'Cooking Oil', 'OIL-002', 'gal', 10, 15.00, 1, 'gal')
ON CONFLICT (id) DO UPDATE SET current_stock = 10, cost_per_unit = 15.00;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-00000000000f', '22222222-2222-2222-2222-222222222222', 'Fried Chicken', 'Fried Chicken', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-00000000000f', 'a0000000-0000-0000-0000-00000000000f', 0.5, 'L');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Fried Chicken',
    8,
    '2025-01-15',
    'order-chicken-001'
  )$$,
  'L to gal standard conversion should succeed'
);

-- 0.5 L * 8 = 4 L
-- 4 L / 3.78541 L/gal = 1.057 gal
-- 10 - 1.057 ≈ 8.943 gal
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-00000000000f') BETWEEN 8.94 AND 8.95,
  'L-gal conversion: 10 - (4L / 3.78541) ≈ 8.943 gal'
);

-- ============================================================
-- TEST CATEGORY 6: STANDARD WEIGHT CONVERSIONS
-- ============================================================

-- Test 16: g to oz (standard weight conversion)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'Cheese Slices', 'CHEESE-001', 'oz', 200, 0.30, 1, 'oz')
ON CONFLICT (id) DO UPDATE SET current_stock = 200, cost_per_unit = 0.30;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000010', '22222222-2222-2222-2222-222222222222', 'Cheeseburger', 'Cheeseburger', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000010', 30, 'g');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Cheeseburger',
    25,
    '2025-01-15',
    'order-cheeseburger-001'
  )$$,
  'g to oz standard conversion should succeed'
);

-- 30 g * 25 = 750 g
-- 750 g * 0.035274 oz/g = 26.4555 oz
-- 200 - 26.4555 ≈ 173.54 oz
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000010') BETWEEN 173.5 AND 173.6,
  'g-oz conversion: 200 - (750g * 0.035274) ≈ 173.54 oz'
);

-- Test 17: kg to lb (standard weight conversion)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'Chicken Breast', 'CHICKEN-001', 'lb', 100, 4.50, 1, 'lb')
ON CONFLICT (id) DO UPDATE SET current_stock = 100, cost_per_unit = 4.50;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000011', '22222222-2222-2222-2222-222222222222', 'Grilled Chicken', 'Grilled Chicken', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000011', 0.2, 'kg');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Grilled Chicken',
    40,
    '2025-01-15',
    'order-grilled-001'
  )$$,
  'kg to lb standard conversion should succeed'
);

-- 0.2 kg * 40 = 8 kg
-- 8 kg * 2.20462 lb/kg = 17.637 lb
-- 100 - 17.637 ≈ 82.36 lb
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000011') BETWEEN 82.35 AND 82.37,
  'kg-lb conversion: 100 - (8kg * 2.20462) ≈ 82.36 lb'
);

-- ============================================================
-- TEST CATEGORY 7: EDGE CASES & ERROR HANDLING
-- ============================================================

-- Test 18: Recipe with no mapped POS item (should return empty result)
SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Nonexistent Item',
    1,
    '2025-01-15',
    'order-none-001'
  )$$,
  'Deduction with non-existent POS item should not fail'
);

SELECT is(
  (SELECT (process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Nonexistent Item',
    1,
    '2025-01-15',
    'order-none-002'
  ))::jsonb->>'recipe_name'),
  ''::text,
  'Non-existent POS item should return empty recipe_name'
);

-- Test 19: Duplicate processing check (already processed)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit) VALUES
  ('a0000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222', 'Duplicate Test Product', 'DUP-001', 'unit', 100, 1.00)
ON CONFLICT (id) DO UPDATE SET current_stock = 100;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000012', '22222222-2222-2222-2222-222222222222', 'Duplicate Test Recipe', 'Duplicate Item', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000012', 1, 'unit');

-- First deduction
SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Duplicate Item',
    5,
    '2025-01-15',
    'order-dup-001'
  )$$,
  'First deduction should succeed'
);

-- Second deduction with same external_order_id (should be skipped)
SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Duplicate Item',
    5,
    '2025-01-15',
    'order-dup-001'
  )$$,
  'Duplicate deduction should not fail'
);

SELECT is(
  (SELECT (process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Duplicate Item',
    5,
    '2025-01-15',
    'order-dup-001'
  ))::jsonb->>'already_processed'),
  'true'::text,
  'Duplicate deduction should be marked as already_processed'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000012'),
  95.0::numeric,
  'Stock should only be deducted once (100 - 5 = 95), not twice'
);

-- Test 20: Zero quantity sale (edge case)
SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Direct Match Item',
    0,
    '2025-01-15',
    'order-zero-001'
  )$$,
  'Zero quantity deduction should not fail'
);

-- Test 21: Large quantity sale
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit) VALUES
  ('a0000000-0000-0000-0000-000000000013', '22222222-2222-2222-2222-222222222222', 'Large Quantity Product', 'LARGE-001', 'unit', 10000, 0.50)
ON CONFLICT (id) DO UPDATE SET current_stock = 10000;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000013', '22222222-2222-2222-2222-222222222222', 'Large Quantity Recipe', 'Large Item', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000013', 1, 'unit');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Large Item',
    500,
    '2025-01-15',
    'order-large-001'
  )$$,
  'Large quantity deduction should succeed'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000013'),
  9500.0::numeric,
  'Large quantity: 10000 - 500 = 9500'
);

-- Test 22: Negative stock scenario (stock goes below zero)
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit) VALUES
  ('a0000000-0000-0000-0000-000000000014', '22222222-2222-2222-2222-222222222222', 'Low Stock Product', 'LOW-001', 'unit', 2, 1.00)
ON CONFLICT (id) DO UPDATE SET current_stock = 2;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000014', '22222222-2222-2222-2222-222222222222', 'Low Stock Recipe', 'Low Stock Item', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000014', 1, 'unit');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Low Stock Item',
    5,
    '2025-01-15',
    'order-low-001'
  )$$,
  'Deduction causing negative stock should not fail'
);

SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000014'),
  0.0::numeric,
  'Stock should be capped at 0 (GREATEST(0, 2-5) = 0)'
);

-- ============================================================
-- TEST CATEGORY 8: INVENTORY TRANSACTION LOGGING
-- ============================================================

-- Test 23: Verify inventory transactions are created
SELECT ok(
  (SELECT COUNT(*) FROM inventory_transactions 
   WHERE restaurant_id = '22222222-2222-2222-2222-222222222222'
     AND transaction_type = 'usage') > 0,
  'Usage transactions should be logged'
);

-- Test 24: Verify transaction reference_id includes external_order_id
SELECT ok(
  (SELECT COUNT(*) FROM inventory_transactions 
   WHERE reference_id LIKE 'order-%'
     AND transaction_type = 'usage') > 0,
  'Transaction reference_id should include external_order_id'
);

-- Test 25: Verify negative quantity in transactions
SELECT ok(
  (SELECT COUNT(*) FROM inventory_transactions 
   WHERE quantity < 0
     AND transaction_type = 'usage') > 0,
  'Usage transactions should have negative quantities'
);

-- Test 26: Verify total_cost is calculated correctly
SELECT ok(
  (SELECT COUNT(*) FROM inventory_transactions 
   WHERE total_cost IS NOT NULL
     AND total_cost < 0
     AND transaction_type = 'usage') > 0,
  'Usage transactions should have negative total_cost'
);

-- ============================================================
-- TEST CATEGORY 9: COST CALCULATION ACCURACY
-- ============================================================

-- Test 27: Verify cost calculation in result
SELECT ok(
  (SELECT (process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Direct Match Item',
    1,
    '2025-01-15',
    'order-cost-test-001'
  ))::jsonb->>'total_cost')::numeric > 0,
  'Deduction result should include positive total_cost'
);

-- Test 28: Verify ingredients_deducted array in result
SELECT ok(
  jsonb_array_length((SELECT (process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Vodka Cocktail',
    1,
    '2025-01-15',
    'order-ingredients-test-001'
  ))::jsonb->'ingredients_deducted')) > 0,
  'Deduction result should include ingredients_deducted array'
);

-- ============================================================
-- TEST CATEGORY 10: MULTI-INGREDIENT RECIPES
-- ============================================================

-- Test 29: Recipe with multiple ingredients using different conversions
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock, cost_per_unit, size_value, size_unit) VALUES
  ('a0000000-0000-0000-0000-000000000015', '22222222-2222-2222-2222-222222222222', 'Tomatoes', 'TOM-001', 'lb', 50, 2.50, 1, 'lb'),
  ('a0000000-0000-0000-0000-000000000016', '22222222-2222-2222-2222-222222222222', 'Onions', 'ONI-001', 'lb', 30, 1.50, 1, 'lb'),
  ('a0000000-0000-0000-0000-000000000017', '22222222-2222-2222-2222-222222222222', 'Garlic', 'GAR-001', 'oz', 100, 0.25, 1, 'oz')
ON CONFLICT (id) DO UPDATE SET 
  current_stock = EXCLUDED.current_stock,
  cost_per_unit = EXCLUDED.cost_per_unit;

INSERT INTO recipes (id, restaurant_id, name, pos_item_name, is_active) VALUES
  ('b0000000-0000-0000-0000-000000000015', '22222222-2222-2222-2222-222222222222', 'Marinara Sauce', 'Marinara', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit) VALUES
  ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000015', 200, 'g'),
  ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000016', 100, 'g'),
  ('b0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000017', 0.5, 'oz');

SELECT lives_ok(
  $$SELECT process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Marinara',
    10,
    '2025-01-15',
    'order-marinara-001'
  )$$,
  'Multi-ingredient recipe deduction should succeed'
);

-- Verify all three products were deducted
-- Tomatoes: 200g * 10 = 2000g = 4.41lb, 50 - 4.41 ≈ 45.59
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000015') BETWEEN 45.5 AND 45.6,
  'Tomatoes deducted correctly in multi-ingredient recipe'
);

-- Onions: 100g * 10 = 1000g = 2.20lb, 30 - 2.20 ≈ 27.80
SELECT ok(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000016') BETWEEN 27.7 AND 27.9,
  'Onions deducted correctly in multi-ingredient recipe'
);

-- Garlic: 0.5oz * 10 = 5oz, 100 - 5 = 95oz
SELECT is(
  (SELECT current_stock FROM products WHERE id = 'a0000000-0000-0000-0000-000000000017'),
  95.0::numeric,
  'Garlic deducted correctly in multi-ingredient recipe'
);

-- Test 30: Verify result contains all three ingredients
SELECT is(
  jsonb_array_length((SELECT (process_unified_inventory_deduction(
    '22222222-2222-2222-2222-222222222222',
    'Marinara',
    1,
    '2025-01-15',
    'order-marinara-verify-001'
  ))::jsonb->'ingredients_deducted')),
  3,
  'Multi-ingredient recipe should return 3 ingredients in result'
);

SELECT * FROM finish();
ROLLBACK;
