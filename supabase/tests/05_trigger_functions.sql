-- Tests for trigger functions
BEGIN;
SELECT plan(23);

-- Test trigger_unified_sales_aggregation function exists
SELECT has_function(
    'public',
    'trigger_unified_sales_aggregation',
    'trigger_unified_sales_aggregation function should exist'
);

SELECT function_returns(
    'public',
    'trigger_unified_sales_aggregation',
    'trigger',
    'trigger_unified_sales_aggregation should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_unified_sales_aggregation',
    'plpgsql',
    'trigger_unified_sales_aggregation should be plpgsql'
);

-- Test trigger_calculate_pnl function exists
SELECT has_function(
    'public',
    'trigger_calculate_pnl',
    'trigger_calculate_pnl function should exist'
);

SELECT function_returns(
    'public',
    'trigger_calculate_pnl',
    'trigger',
    'trigger_calculate_pnl should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_calculate_pnl',
    'plpgsql',
    'trigger_calculate_pnl should be plpgsql'
);

-- Test trigger_automatic_inventory_deduction function exists
SELECT has_function(
    'public',
    'trigger_automatic_inventory_deduction',
    'trigger_automatic_inventory_deduction function should exist'
);

SELECT function_returns(
    'public',
    'trigger_automatic_inventory_deduction',
    'trigger',
    'trigger_automatic_inventory_deduction should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_automatic_inventory_deduction',
    'plpgsql',
    'trigger_automatic_inventory_deduction should be plpgsql'
);

-- Test trigger_aggregate_inventory_usage function exists
SELECT has_function(
    'public',
    'trigger_aggregate_inventory_usage',
    'trigger_aggregate_inventory_usage function should exist'
);

SELECT function_returns(
    'public',
    'trigger_aggregate_inventory_usage',
    'trigger',
    'trigger_aggregate_inventory_usage should return trigger'
);

SELECT function_lang_is(
    'public',
    'trigger_aggregate_inventory_usage',
    'plpgsql',
    'trigger_aggregate_inventory_usage should be plpgsql'
);

-- Test update_updated_at_column function exists
SELECT has_function(
    'public',
    'update_updated_at_column',
    'update_updated_at_column function should exist'
);

SELECT function_returns(
    'public',
    'update_updated_at_column',
    'trigger',
    'update_updated_at_column should return trigger'
);

SELECT function_lang_is(
    'public',
    'update_updated_at_column',
    'plpgsql',
    'update_updated_at_column should be plpgsql'
);

-- Test update_products_search_vector function exists
SELECT has_function(
    'public',
    'update_products_search_vector',
    'update_products_search_vector function should exist'
);

SELECT function_returns(
    'public',
    'update_products_search_vector',
    'trigger',
    'update_products_search_vector should return trigger'
);

-- Test sync_output_product_shelf_life function exists
SELECT has_function(
    'public',
    'sync_output_product_shelf_life',
    'sync_output_product_shelf_life function should exist'
);

SELECT function_returns(
    'public',
    'sync_output_product_shelf_life',
    'trigger',
    'sync_output_product_shelf_life should return trigger'
);

-- ============================================================
-- Behavioral tests for sync_output_product_shelf_life() trigger
-- ============================================================

-- Disable RLS for test data setup (trigger is SECURITY DEFINER, doesn't require auth)
SET LOCAL row_security = off;

-- Set up test restaurant (no auth needed with RLS disabled)
INSERT INTO restaurants (id, name) VALUES ('05000000-0000-0000-0000-000000000001', 'Trigger Test Restaurant') ON CONFLICT DO NOTHING;

-- Test products: one with null shelf_life, one with existing shelf_life
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, cost_per_unit, current_stock, shelf_life_days)
VALUES
  ('05000000-0000-0000-0000-000000000010', '05000000-0000-0000-0000-000000000001', 'SYNC-TEST-1', 'Sync Test Product NULL', 'unit', 0, 0, NULL),
  ('05000000-0000-0000-0000-000000000011', '05000000-0000-0000-0000-000000000001', 'SYNC-TEST-2', 'Sync Test Product ZERO', 'unit', 0, 0, 0),
  ('05000000-0000-0000-0000-000000000012', '05000000-0000-0000-0000-000000000001', 'SYNC-TEST-3', 'Sync Test Product EXISTING', 'unit', 0, 0, 7)
ON CONFLICT (id) DO UPDATE SET shelf_life_days = EXCLUDED.shelf_life_days;

-- Linked recipes for prep recipes
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES
  ('05000000-0000-0000-0000-000000000100', '05000000-0000-0000-0000-000000000001', 'Sync Test Recipe 1', 1, true),
  ('05000000-0000-0000-0000-000000000101', '05000000-0000-0000-0000-000000000001', 'Sync Test Recipe 2', 1, true),
  ('05000000-0000-0000-0000-000000000102', '05000000-0000-0000-0000-000000000001', 'Sync Test Recipe 3', 1, true),
  ('05000000-0000-0000-0000-000000000103', '05000000-0000-0000-0000-000000000001', 'Sync Test Recipe NULL Output', 1, true)
ON CONFLICT DO NOTHING;

-- Test 1: INSERT prep_recipe with shelf_life_days should update product with NULL shelf_life
INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id, shelf_life_days)
VALUES ('05000000-0000-0000-0000-000000000020', '05000000-0000-0000-0000-000000000001', '05000000-0000-0000-0000-000000000100', 'Test Prep 1', 1, 'unit', '05000000-0000-0000-0000-000000000010', 5)
ON CONFLICT DO NOTHING;

SELECT is(
  (SELECT shelf_life_days FROM products WHERE id = '05000000-0000-0000-0000-000000000010'),
  5,
  'sync_output_product_shelf_life: updates product shelf_life when it was NULL'
);

-- Test 2: INSERT prep_recipe should update product with shelf_life = 0
INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id, shelf_life_days)
VALUES ('05000000-0000-0000-0000-000000000021', '05000000-0000-0000-0000-000000000001', '05000000-0000-0000-0000-000000000101', 'Test Prep 2', 1, 'unit', '05000000-0000-0000-0000-000000000011', 3)
ON CONFLICT DO NOTHING;

SELECT is(
  (SELECT shelf_life_days FROM products WHERE id = '05000000-0000-0000-0000-000000000011'),
  3,
  'sync_output_product_shelf_life: updates product shelf_life when it was 0'
);

-- Test 3: INSERT prep_recipe should NOT overwrite existing non-zero shelf_life
INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id, shelf_life_days)
VALUES ('05000000-0000-0000-0000-000000000022', '05000000-0000-0000-0000-000000000001', '05000000-0000-0000-0000-000000000102', 'Test Prep 3', 1, 'unit', '05000000-0000-0000-0000-000000000012', 14)
ON CONFLICT DO NOTHING;

SELECT is(
  (SELECT shelf_life_days FROM products WHERE id = '05000000-0000-0000-0000-000000000012'),
  7,
  'sync_output_product_shelf_life: does NOT overwrite existing non-zero shelf_life'
);

-- Test 4: INSERT prep_recipe with NULL output_product_id should not raise errors
SELECT lives_ok(
  $$INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id, shelf_life_days)
    VALUES ('05000000-0000-0000-0000-000000000023', '05000000-0000-0000-0000-000000000001', '05000000-0000-0000-0000-000000000103', 'Test Prep NULL Output', 1, 'unit', NULL, 10)
    ON CONFLICT DO NOTHING$$,
  'sync_output_product_shelf_life: handles NULL output_product_id without error'
);

SELECT * FROM finish();
ROLLBACK;
