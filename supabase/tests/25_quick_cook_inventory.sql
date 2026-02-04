-- Quick Cook Inventory Tests
-- Verifies the "Cook Now" functionality correctly:
-- 1. Deducts ingredients from inventory at 1X yield
-- 2. Adds output product to inventory
-- 3. Calculates and assigns cost_per_unit to output
-- 4. Creates proper audit trail via inventory_transactions

BEGIN;
SELECT plan(17);

-- ============================================================
-- Setup: Auth context and restaurant
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('20000000-0000-0000-0000-0000000000ab', 'quickcook-test@example.com') ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name) VALUES ('20000000-0000-0000-0000-000000000001', 'Quick Cook Test Restaurant') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('20000000-0000-0000-0000-0000000000ab', '20000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Test 1: Basic Quick Cook - Marinara Sauce
-- 2 cans tomatoes ($3.50 each) + 1 lb garlic ($8) = $15 total
-- Output: 4 qt of sauce at $3.75/qt
-- ============================================================

-- Products
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', 'TOMATO-CAN', 'Crushed Tomatoes', 'can', 28, 'oz', 3.50, 20),
  ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'GARLIC-LB', 'Fresh Garlic', 'lb', 1, 'lb', 8.00, 10),
  ('20000000-0000-0000-0000-000000000012', '20000000-0000-0000-0000-000000000001', 'MARINARA-QT', 'House Marinara', 'qt', 1, 'qt', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Prep recipe with linked recipe (required for unified deductions)
INSERT INTO recipes (id, restaurant_id, name, description, serving_size, is_active)
VALUES ('20000000-0000-0000-0000-000000000100', '20000000-0000-0000-0000-000000000001', 'House Marinara', 'Classic tomato sauce', 4, true)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES
  ('20000000-0000-0000-0000-000000000100', '20000000-0000-0000-0000-000000000010', 2, 'can'),
  ('20000000-0000-0000-0000-000000000100', '20000000-0000-0000-0000-000000000011', 1, 'lb')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('20000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000100', 'House Marinara', 4, 'qt', '20000000-0000-0000-0000-000000000012')
ON CONFLICT DO NOTHING;

-- Simulate quick cook: Create production run and immediately complete
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020', 'in_progress', 4, 'qt', '20000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES
  ('20000000-0000-0000-0000-000000000040', '20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000010', 2, 2, 'can'),
  ('20000000-0000-0000-0000-000000000041', '20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000011', 1, 1, 'lb')
ON CONFLICT DO NOTHING;

-- Execute quick cook (complete immediately at 1X yield)
SELECT complete_production_run('20000000-0000-0000-0000-000000000030', 4, 'qt', '[]'::jsonb);

-- Test 1: Tomato stock reduced
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000010'),
  18::numeric,
  'Quick Cook: Tomato stock reduced from 20 to 18 (used 2 cans)'
);

-- Test 2: Garlic stock reduced
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000011'),
  9::numeric,
  'Quick Cook: Garlic stock reduced from 10 to 9 (used 1 lb)'
);

-- Test 3: Output product stock increased
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000012'),
  4::numeric,
  'Quick Cook: Marinara stock increased from 0 to 4 qt'
);

-- Test 4: Output product cost_per_unit calculated
-- Total cost: 2×$3.50 + 1×$8 = $15.00
-- Per unit: $15.00 / 4 qt = $3.75
SELECT is(
  (SELECT cost_per_unit::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000012'),
  3.75::numeric,
  'Quick Cook: Marinara cost_per_unit set to $3.75 ($15 / 4 qt)'
);

-- Test 5: Production run marked completed
SELECT is(
  (SELECT status FROM production_runs WHERE id = '20000000-0000-0000-0000-000000000030'),
  'completed',
  'Quick Cook: Production run status is completed'
);

-- Test 6: Production run has actual_total_cost
SELECT is(
  (SELECT actual_total_cost::numeric FROM production_runs WHERE id = '20000000-0000-0000-0000-000000000030'),
  15::numeric,
  'Quick Cook: Production run actual_total_cost is $15'
);

-- Test 7: Inventory transaction for tomato deduction
SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions
   WHERE reference_id LIKE '20000000-0000-0000-0000-000000000030_%'
   AND product_id = '20000000-0000-0000-0000-000000000010'
   AND transaction_type = 'usage'),
  1::bigint,
  'Quick Cook: Tomato usage transaction exists'
);

-- Test 8: Inventory transaction for output addition
SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions
   WHERE reference_id LIKE '20000000-0000-0000-0000-000000000030_%'
   AND product_id = '20000000-0000-0000-0000-000000000012'
   AND transaction_type = 'transfer'),
  1::bigint,
  'Quick Cook: Marinara output transaction exists'
);

-- ============================================================
-- Test 2: Quick Cook with Insufficient Stock (should still work)
-- The system allows cooking even with insufficient stock
-- ============================================================

-- Low stock ingredient
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES ('20000000-0000-0000-0000-000000000013', '20000000-0000-0000-0000-000000000001', 'LOWSTOCK', 'Low Stock Item', 'lb', 1, 'lb', 10.00, 2)
ON CONFLICT (id) DO UPDATE SET current_stock = 2, cost_per_unit = 10.00;

INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('20000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000001', 'Low Stock Recipe', 1, true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000101', '20000000-0000-0000-0000-000000000013', 5, 'lb');

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('20000000-0000-0000-0000-000000000021', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000101', 'Low Stock Recipe', 1, 'unit', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000021', 'in_progress', 1, 'unit', '20000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000042', '20000000-0000-0000-0000-000000000031', '20000000-0000-0000-0000-000000000013', 5, 5, 'lb')
ON CONFLICT DO NOTHING;

-- Execute quick cook (uses 5 lb but only 2 in stock -> stock caps at 0)
SELECT complete_production_run('20000000-0000-0000-0000-000000000031', 1, 'unit', '[]'::jsonb);

-- Test 9: Stock caps at 0 (doesn't go negative, but transaction records full deduction)
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000013'),
  0::numeric,
  'Quick Cook: Low stock caps at 0 (deduction recorded in transaction)'
);

-- Test 10: Transaction records the full deduction (for accurate accounting)
SELECT is(
  (SELECT quantity::numeric FROM inventory_transactions
   WHERE reference_id LIKE '20000000-0000-0000-0000-000000000031_%'
   AND product_id = '20000000-0000-0000-0000-000000000013'
   AND transaction_type = 'usage'),
  -5::numeric,
  'Quick Cook: Transaction records full -5 deduction (for accounting)'
);

-- Test 11: Run still completes even with insufficient stock
SELECT is(
  (SELECT status FROM production_runs WHERE id = '20000000-0000-0000-0000-000000000031'),
  'completed',
  'Quick Cook: Run completes even with insufficient stock'
);

-- ============================================================
-- Test 3: Quick Cook with Unit Conversion (oz recipe -> lb stock)
-- ============================================================

INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('20000000-0000-0000-0000-000000000014', '20000000-0000-0000-0000-000000000001', 'FLOUR-LB', 'All Purpose Flour', 'lb', 1, 'lb', 2.00, 50),
  ('20000000-0000-0000-0000-000000000015', '20000000-0000-0000-0000-000000000001', 'DOUGH-LB', 'Pizza Dough', 'lb', 1, 'lb', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('20000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000001', 'Pizza Dough', 10, true)
ON CONFLICT DO NOTHING;

-- Recipe uses 8 oz but product is stocked in lb
INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000102', '20000000-0000-0000-0000-000000000014', 8, 'oz')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('20000000-0000-0000-0000-000000000022', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000102', 'Pizza Dough', 10, 'lb', '20000000-0000-0000-0000-000000000015')
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('20000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000022', 'in_progress', 10, 'lb', '20000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000043', '20000000-0000-0000-0000-000000000032', '20000000-0000-0000-0000-000000000014', 8, 8, 'oz')
ON CONFLICT DO NOTHING;

SELECT complete_production_run('20000000-0000-0000-0000-000000000032', 10, 'lb', '[]'::jsonb);

-- Test 12: Flour stock reduced correctly with oz->lb conversion
-- 8 oz = 0.5 lb, so 50 - 0.5 = 49.5
SELECT ok(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000014') BETWEEN 49.4 AND 49.6,
  'Quick Cook: Flour stock reduced by 0.5 lb (8 oz converted)'
);

-- Test 13: Dough output added correctly
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000015'),
  10::numeric,
  'Quick Cook: Dough output is 10 lb'
);

-- Test 14: Dough cost calculated from flour cost
-- 8 oz = 0.5 lb × $2/lb = $1.00 total cost
-- $1.00 / 10 lb = $0.10 per lb
SELECT ok(
  (SELECT cost_per_unit::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000015') BETWEEN 0.09 AND 0.11,
  'Quick Cook: Dough cost_per_unit is ~$0.10/lb ($1 / 10 lb)'
);

-- ============================================================
-- Test 4: Quick Cook Multiple Times (Accumulating Stock)
-- ============================================================

-- Second marinara quick cook (adds to existing 4 qt)
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('20000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020', 'in_progress', 4, 'qt', '20000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES
  ('20000000-0000-0000-0000-000000000044', '20000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000010', 2, 2, 'can'),
  ('20000000-0000-0000-0000-000000000045', '20000000-0000-0000-0000-000000000033', '20000000-0000-0000-0000-000000000011', 1, 1, 'lb')
ON CONFLICT DO NOTHING;

SELECT complete_production_run('20000000-0000-0000-0000-000000000033', 4, 'qt', '[]'::jsonb);

-- Test 15: Marinara stock accumulated
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000012'),
  8::numeric,
  'Quick Cook: Second cook adds 4 qt, total now 8 qt'
);

-- Test 16: Tomato stock reduced again
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000010'),
  16::numeric,
  'Quick Cook: Tomato reduced from 18 to 16 (second cook used 2 more)'
);

-- Test 17: Garlic stock reduced again
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000011'),
  8::numeric,
  'Quick Cook: Garlic reduced from 9 to 8 (second cook used 1 more)'
);

SELECT * FROM finish();
ROLLBACK;
