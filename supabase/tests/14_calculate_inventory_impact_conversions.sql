-- Tests for calculate_inventory_impact_for_product function
-- Validates volume conversions (fl oz→ml, cup→ml, tbsp, tsp, qt, gal)
-- and weight conversions (oz→g, lb→g) after the refactor
BEGIN;
SELECT plan(17);

-- Setup authenticated user context for tests
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);

-- Disable RLS for testing
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Setup: Create test restaurant and user access
INSERT INTO restaurants (id, name) VALUES
  ('33333333-3333-3333-3333-333333333333', 'Test Restaurant Conversions')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000000', 'test@example.com')
ON CONFLICT (id) DO NOTHING;

-- Clean up any existing user_restaurants records for this user to ensure clean test state
DELETE FROM user_restaurants WHERE user_id = '00000000-0000-0000-0000-000000000000';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- ============================================================
-- TEST CATEGORY 1: VOLUME CONVERSIONS (fl oz, cup, tbsp, tsp, qt, gal)
-- ============================================================

-- Test 1: fl oz to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000001'::uuid,
    2.0,
    'fl oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  2.0,
  'fl oz to ml conversion should return input quantity when no product exists'
);

-- Test 2: cup to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000002'::uuid,
    1.0,
    'cup',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  1.0,
  'cup to ml conversion should return input quantity when no product exists'
);

-- Test 3: tbsp to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000003'::uuid,
    3.0,
    'tbsp',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  3.0,
  'tbsp to ml conversion should return input quantity when no product exists'
);

-- Test 4: tsp to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000004'::uuid,
    4.0,
    'tsp',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  4.0,
  'tsp to ml conversion should return input quantity when no product exists'
);

-- Test 5: qt to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000005'::uuid,
    0.5,
    'qt',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  0.5,
  'qt to ml conversion should return input quantity when no product exists'
);

-- Test 6: gal to ml conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000006'::uuid,
    0.25,
    'gal',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  0.25,
  'gal to ml conversion should return input quantity when no product exists'
);

-- ============================================================
-- TEST CATEGORY 2: WEIGHT CONVERSIONS (oz, lb)
-- ============================================================

-- Test 7: oz to g conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000007'::uuid,
    8.0,
    'oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  8.0,
  'oz to g conversion should return input quantity when no product exists'
);

-- Test 8: lb to g conversion
SELECT is(
  calculate_inventory_impact_for_product(
    'a0000000-0000-0000-0000-000000000008'::uuid,
    2.0,
    'lb',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  2.0,
  'lb to g conversion should return input quantity when no product exists'
);

-- ============================================================
-- TEST CATEGORY 3: CONTAINER UNIT CONVERSIONS WITH VOLUME
-- ============================================================

-- Test 9: Create product with bottle container and volume size
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, size_value, size_unit, current_stock) VALUES
  ('c0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Vodka Bottle', 'VODKA-750', 'bottle', 750, 'ml', 10)
ON CONFLICT (id) DO UPDATE SET current_stock = 10;

-- Test 10: fl oz recipe to bottle container (volume context)
SELECT is(
  calculate_inventory_impact_for_product(
    'c0000000-0000-0000-0000-000000000001'::uuid,
    1.5,
    'fl oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  1.5 * 29.5735 / 750,  -- 1.5 fl oz = 44.36 ml, 44.36 / 750 = 0.05915 bottles
  'fl oz to bottle container should calculate correct impact'
);

-- ============================================================
-- TEST CATEGORY 4: CONTAINER UNIT CONVERSIONS WITH WEIGHT
-- ============================================================

-- Test 11: Create product with box container and weight size
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, size_value, size_unit, current_stock) VALUES
  ('c0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Pasta Box', 'PASTA-500', 'box', 500, 'g', 5)
ON CONFLICT (id) DO UPDATE SET current_stock = 5;

-- Test 12: oz recipe to box container (weight context)
SELECT is(
  calculate_inventory_impact_for_product(
    'c0000000-0000-0000-0000-000000000002'::uuid,
    4.0,
    'oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  4.0 * 28.3495 / 500,  -- 4 oz = 113.398 g, 113.398 / 500 = 0.2268 boxes
  'oz to box container should calculate correct impact'
);

-- ============================================================
-- TEST CATEGORY 5: STANDARD UNIT CONVERSIONS
-- ============================================================

-- Test 13: Create product with fl oz purchase unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock) VALUES
  ('d0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Syrup', 'SYRUP-001', 'fl oz', 100)
ON CONFLICT (id) DO UPDATE SET current_stock = 100;

-- Test 14: cup recipe to fl oz purchase (volume conversion)
SELECT is(
  calculate_inventory_impact_for_product(
    'd0000000-0000-0000-0000-000000000001'::uuid,
    0.5,
    'cup',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  0.5 * 236.588 / 29.5735,  -- 0.5 cup = 118.294 ml, 118.294 / 29.5735 = 4.0 fl oz
  'cup to fl oz should calculate correct volume conversion'
);

-- Test 15: Create product with oz purchase unit
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, current_stock) VALUES
  ('d0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Flour', 'FLOUR-001', 'oz', 200)
ON CONFLICT (id) DO UPDATE SET current_stock = 200;

-- Test 16: lb recipe to oz purchase (weight conversion)
SELECT is(
  calculate_inventory_impact_for_product(
    'd0000000-0000-0000-0000-000000000002'::uuid,
    0.5,
    'lb',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  0.5 * 453.592 / 28.3495,  -- 0.5 lb = 226.796 g, 226.796 / 28.3495 = 8.0 oz
  'lb to oz should calculate correct weight conversion'
);

-- ============================================================
-- TEST CATEGORY 6: DENSITY CONVERSIONS (cup to weight)
-- ============================================================

-- Test 17: Create rice product
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, size_value, size_unit, current_stock) VALUES
  ('e0000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Rice Bag', 'RICE-10KG', 'bag', 10, 'kg', 3)
ON CONFLICT (id) DO UPDATE SET current_stock = 3;

-- Test 18: cup rice recipe to kg bag (density conversion)
SELECT is(
  calculate_inventory_impact_for_product(
    'e0000000-0000-0000-0000-000000000001'::uuid,
    2.0,
    'cup',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  (2.0 * 185) / 10000,  -- 2 cups rice = 370g, 370 / 10000 = 0.037 bags
  'cup rice to kg bag should use density conversion'
);

-- Test 19: Create flour product
INSERT INTO products (id, restaurant_id, name, sku, uom_purchase, size_value, size_unit, current_stock) VALUES
  ('e0000000-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333', 'Flour Bag', 'FLOUR-5KG', 'bag', 5, 'kg', 4)
ON CONFLICT (id) DO UPDATE SET current_stock = 4;

-- Test 20: cup flour recipe to kg bag (density conversion)
SELECT is(
  calculate_inventory_impact_for_product(
    'e0000000-0000-0000-0000-000000000002'::uuid,
    3.0,
    'cup',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  (3.0 * 120) / 5000,  -- 3 cups flour = 360g, 360 / 5000 = 0.072 bags
  'cup flour to kg bag should use density conversion'
);

-- ============================================================
-- TEST CATEGORY 7: EDGE CASES
-- ============================================================

-- Test 21: Non-existent product should return input quantity
SELECT is(
  calculate_inventory_impact_for_product(
    '99999999-9999-9999-9999-999999999999'::uuid,
    1.0,
    'cup',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  1.0,
  'Non-existent product should return input quantity'
);

-- Test 22: Zero quantity should return zero
SELECT is(
  calculate_inventory_impact_for_product(
    'c0000000-0000-0000-0000-000000000001'::uuid,
    0.0,
    'fl oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  0.0,
  'Zero quantity should return zero'
);

-- Test 23: Large quantity should scale correctly
SELECT is(
  calculate_inventory_impact_for_product(
    'c0000000-0000-0000-0000-000000000001'::uuid,
    100.0,
    'fl oz',
    '33333333-3333-3333-3333-333333333333'::uuid
  ),
  100.0 * 29.5735 / 750,  -- 100 fl oz = 2957.35 ml, 2957.35 / 750 = 3.943 bottles
  'Large quantity should scale correctly'
);

SELECT * FROM finish();
ROLLBACK;