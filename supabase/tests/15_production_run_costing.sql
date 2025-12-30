-- Verify production run costing and inventory impact for a simple batch:
-- 5 lb chicken breast -> 10 L chicken broth
BEGIN;
SELECT plan(8);

-- Auth context
SELECT set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('10000000-0000-0000-0000-0000000000ab', 'batch-test@example.com') ON CONFLICT DO NOTHING;

-- Arrange restaurant and access
INSERT INTO restaurants (id, name) VALUES ('10000000-0000-0000-0000-000000000001', 'Batch Test R') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('10000000-0000-0000-0000-0000000000ab', '10000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- Products: ingredient (lb) and output (L)
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('10000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', 'CHICKEN-LB', 'Chicken Breast', 'lb', 1, 'lb', 4.99, 100),
  ('10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000001', 'SOUP-L', 'Chicken Soup Base', 'L', 1, 'L', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Prep recipe blueprint and production run
INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('10000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000001', 'Chicken Soup Base', 10, 'L', '10000000-0000-0000-0000-000000000011')
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000020', 'in_progress', 10, 'L', '10000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('10000000-0000-0000-0000-000000000040', '10000000-0000-0000-0000-000000000030', '10000000-0000-0000-0000-000000000010', 5, 5, 'lb')
ON CONFLICT DO NOTHING;

-- Act
SELECT complete_production_run('10000000-0000-0000-0000-000000000030', 10, 'L', '[]'::jsonb);

-- Assert ingredient stock reduced by 5 lb
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '10000000-0000-0000-0000-000000000010'),
  95::numeric,
  'Chicken breast stock reduced by 5 lb'
);

-- Assert output stock increased by 10 L
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '10000000-0000-0000-0000-000000000011'),
  10::numeric,
  'Soup output increased by 10 L'
);

-- Ingredient transaction: quantity and total cost
SELECT is(
  (SELECT quantity::numeric FROM inventory_transactions WHERE reference_id = '10000000-0000-0000-0000-000000000030' AND product_id = '10000000-0000-0000-0000-000000000010' LIMIT 1),
  -5::numeric,
  'Ingredient transaction deducts 5 lb'
);

SELECT is(
  (SELECT total_cost::numeric FROM inventory_transactions WHERE reference_id = '10000000-0000-0000-0000-000000000030' AND product_id = '10000000-0000-0000-0000-000000000010' LIMIT 1),
  -24.95::numeric,
  'Ingredient transaction total cost is -$24.95 (5 lb × $4.99)'
);

-- Output transaction: quantity, unit cost, total cost
SELECT is(
  (SELECT quantity::numeric FROM inventory_transactions WHERE reference_id = '10000000-0000-0000-0000-000000000030' AND product_id = '10000000-0000-0000-0000-000000000011' LIMIT 1),
  10::numeric,
  'Output transaction adds 10 L'
);

SELECT is(
  (SELECT unit_cost::numeric FROM inventory_transactions WHERE reference_id = '10000000-0000-0000-0000-000000000030' AND product_id = '10000000-0000-0000-0000-000000000011' LIMIT 1),
  2.495::numeric,
  'Output unit cost is $2.495 (batch $24.95 / 10 L)'
);

SELECT is(
  (SELECT total_cost::numeric FROM inventory_transactions WHERE reference_id = '10000000-0000-0000-0000-000000000030' AND product_id = '10000000-0000-0000-0000-000000000011' LIMIT 1),
  24.95::numeric,
  'Output transaction total cost is $24.95'
);

-- Production run cost snapshot
SELECT is(
  (SELECT cost_per_unit::numeric FROM production_runs WHERE id = '10000000-0000-0000-0000-000000000030'),
  2.495::numeric,
  'Run cost_per_unit recorded as $2.495 per L'
);

SELECT * FROM finish();
ROLLBACK;
