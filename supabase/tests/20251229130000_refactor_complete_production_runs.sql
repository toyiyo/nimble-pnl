-- Tests for migration 20251229130000_refactor_complete_production_runs.sql
-- Tests the calculate_inventory_impact_for_product function and complete_production_run updates
BEGIN;

SELECT plan(13);

-- Setup authenticated user context for tests
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

-- Disable RLS for testing
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Setup: Create test restaurant and user access
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Test Restaurant Migration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- ============================================================
-- TEST CATEGORY 1: calculate_inventory_impact_for_product function
-- ============================================================

-- Test 1: Direct match kg -> kg
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'KG1', 'Flour KG', 'kg', 1, 'kg', 1.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000001', 2, 'kg', '00000000-0000-0000-0000-000000000001'),
  2::numeric,
  'KG to KG stays 1:1'
);

-- Test 2: Volume bottle: 29.5735ml fl oz into 750ml bottle => 1 fl oz ≈ 0.0394 bottles
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'VODKA', 'Vodka Bottle', 'bottle', 750, 'ml', 12.00)
ON CONFLICT DO NOTHING;

SELECT is(
  round(public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000002', 1, 'fl oz', '00000000-0000-0000-0000-000000000001'), 4),
  round((29.5735 / 750)::numeric, 4),
  'fl oz converts to fraction of 750ml bottle'
);

-- Test 3: Weight bag: 4 oz flour into 1 kg bag => 113.398/1000 = 0.1134 bags
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'FLOUR', 'Flour Bag', 'bag', 1, 'kg', 2.50)
ON CONFLICT DO NOTHING;

SELECT is(
  round(public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000003', 4, 'oz', '00000000-0000-0000-0000-000000000001'), 4),
  round((4 * 28.3495 / 1000)::numeric, 4),
  'Weight oz converts to kg bag fraction'
);

-- Test 4: Cup density: 1 cup rice into 10 kg bag => 185g/10kg = 0.0185 bags
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'RICE', 'Basmati Rice', 'bag', 10, 'kg', 20.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000004', 1, 'cup', '00000000-0000-0000-0000-000000000001'),
  round((185 / 10000.0)::numeric, 4),
  'Cup of rice uses density conversion'
);

-- Test 5: Fallback: unknown units stay 1:1
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit)
VALUES ('30000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'MISC', 'Misc Item', 'unit', 1, 'unit', 1.00)
ON CONFLICT DO NOTHING;

SELECT is(
  public.calculate_inventory_impact_for_product('30000000-0000-0000-0000-000000000005', 3, 'unit', '00000000-0000-0000-0000-000000000001'),
  3::numeric,
  'Unknown stays raw quantity'
);

-- ============================================================
-- TEST CATEGORY 2: complete_production_run function updates
-- ============================================================

-- Test 6: Production run completion with inventory conversion
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'RAW-CHICKEN', 'Raw Chicken', 'kg', 1, 'kg', 4.00, 50),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'WATER', 'Water', 'L', 1, 'L', 0.10, 100),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'SOUP-BASE', 'Chicken Soup Base', 'L', 1, 'L', 0, 0)
ON CONFLICT DO NOTHING;

-- Prep recipe blueprint (linked to recipe for unified deductions)
INSERT INTO recipes (id, restaurant_id, name, description, serving_size, is_active)
VALUES ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-000000000001', 'Chicken Soup Base', NULL, 10, true)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-000000000011', 5.25, 'kg'),
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-000000000012', 5, 'L')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000221', 'Chicken Soup Base', 10, 'L', '00000000-0000-0000-0000-000000000013')
ON CONFLICT DO NOTHING;

-- Production run and ingredients (batch scaled to 20L, actual same as expected)
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021', 'in_progress', 20, 'L', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', 10.5, 10.5, 'kg'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000012', 10, 10, 'L')
ON CONFLICT DO NOTHING;

-- Act: complete the production run
SELECT complete_production_run('00000000-0000-0000-0000-000000000031', 20, 'L', '[]'::jsonb);

-- Assert inventory movements
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '00000000-0000-0000-0000-000000000011'),
  39.5::numeric,
  'Chicken stock reduced by 10.5 kg'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '00000000-0000-0000-0000-000000000012'),
  90::numeric,
  'Water stock reduced by 10 L'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '00000000-0000-0000-0000-000000000013'),
  20::numeric,
  'Soup base stock increased by 20 L'
);

-- Assert transactions: all transfers (ingredients out, output in) - not COGS until sold
SELECT is(
  (SELECT count(*)::bigint FROM inventory_transactions WHERE reference_id LIKE '00000000-0000-0000-0000-000000000031_%' AND transaction_type = 'transfer' AND quantity < 0),
  2::bigint,
  'Two transfer-out transactions for ingredients (not COGS)'
);

SELECT is(
  (SELECT count(*)::bigint FROM inventory_transactions WHERE reference_id LIKE '00000000-0000-0000-0000-000000000031_%' AND transaction_type = 'transfer' AND quantity > 0),
  1::bigint,
  'One transfer-in transaction for output'
);

SELECT is(
  (SELECT status FROM production_runs WHERE id = '00000000-0000-0000-0000-000000000031'),
  'completed',
  'Production run marked completed'
);

-- Test 7: Output conversion applies purchase unit (ml -> bottle)
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'SOUP-BOTTLE', 'Soup Bottled', 'bottle', 750, 'ml', 0, 0)
ON CONFLICT DO NOTHING;

INSERT INTO recipes (id, restaurant_id, name, description, serving_size, is_active)
VALUES ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000001', 'Soup Bottled', NULL, 1500, true)
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000222', 'Soup Bottled', 1500, 'ml', '00000000-0000-0000-0000-000000000014')
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('00000000-0000-0000-0000-000000000033', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000022', 'in_progress', 1500, 'ml', NULL)
ON CONFLICT DO NOTHING;

SELECT complete_production_run('00000000-0000-0000-0000-000000000033', 1500, 'ml', '[]'::jsonb);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '00000000-0000-0000-0000-000000000014'),
  2::numeric,
  'Output stock uses converted purchase units'
);

SELECT is(
  (SELECT quantity::numeric FROM inventory_transactions WHERE reference_id LIKE '00000000-0000-0000-0000-000000000033_%' AND product_id = '00000000-0000-0000-0000-000000000014' AND transaction_type = 'transfer'),
  2::numeric,
  'Output transaction quantity uses converted units'
);

SELECT * FROM finish();
ROLLBACK;
