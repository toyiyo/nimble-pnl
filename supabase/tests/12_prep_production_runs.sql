-- Prep production run should convert ingredients, record usage, and transfer in output with cost snapshot
BEGIN;

-- Setup
SELECT plan(6);

-- Auth context
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000ab', 'prep-test@example.com') ON CONFLICT DO NOTHING;

-- Arrange
INSERT INTO restaurants (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Test R') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role) 
VALUES ('00000000-0000-0000-0000-0000000000ab', '00000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- Products
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'RAW-CHICKEN', 'Raw Chicken', 'kg', 1, 'kg', 4.00, 50),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'WATER', 'Water', 'L', 1, 'L', 0.10, 100),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'SOUP-BASE', 'Chicken Soup Base', 'L', 1, 'L', 0, 0);

-- Prep recipe blueprint (linked to recipe for unified deductions)
INSERT INTO recipes (id, restaurant_id, name, description, serving_size, is_active)
VALUES ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000001', 'Chicken Soup Base', NULL, 10, true)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000011', 5.25, 'kg'),
  ('00000000-0000-0000-0000-000000000121', '00000000-0000-0000-0000-000000000012', 5, 'L')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000121', 'Chicken Soup Base', 10, 'L', '00000000-0000-0000-0000-000000000013');

-- Production run and ingredients (batch scaled to 20L, actual same as expected)
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000021', 'in_progress', 20, 'L', NULL);

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES
  ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000011', 10.5, 10.5, 'kg'),
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000012', 10, 10, 'L');

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

SELECT * FROM finish();
ROLLBACK;
