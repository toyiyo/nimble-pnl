-- Test idempotency of complete_production_run function
-- Calling complete_production_run multiple times should not create duplicate transactions
BEGIN;
SELECT plan(6);

-- Disable RLS for test data setup
SET LOCAL row_security = off;

-- Auth context (needed for complete_production_run which calls auth.uid())
SELECT set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);

-- Create auth user directly (bypasses RLS with row_security off)
INSERT INTO auth.users (id, email, instance_id, aud, role, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token)
VALUES (
  '20000000-0000-0000-0000-0000000000ab',
  'idempotency-test@example.com',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  '',
  now(),
  now(),
  now(),
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- Arrange restaurant and access
INSERT INTO restaurants (id, name) VALUES ('20000000-0000-0000-0000-000000000001', 'Idempotency Test R') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('20000000-0000-0000-0000-0000000000ab', '20000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- Products: ingredient and output
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('20000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000001', 'FLOUR-LB', 'Flour', 'lb', 1, 'lb', 2.00, 50),
  ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000001', 'DOUGH-LB', 'Pizza Dough', 'lb', 1, 'lb', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- Recipe setup
INSERT INTO recipes (id, restaurant_id, name, description, serving_size, is_active)
VALUES ('20000000-0000-0000-0000-000000000120', '20000000-0000-0000-0000-000000000001', 'Pizza Dough', NULL, 10, true)
ON CONFLICT DO NOTHING;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000120', '20000000-0000-0000-0000-000000000010', 5, 'lb')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('20000000-0000-0000-0000-000000000020', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000120', 'Pizza Dough', 10, 'lb', '20000000-0000-0000-0000-000000000011')
ON CONFLICT DO NOTHING;

-- Production run
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000020', 'in_progress', 10, 'lb', '20000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('20000000-0000-0000-0000-000000000040', '20000000-0000-0000-0000-000000000030', '20000000-0000-0000-0000-000000000010', 5, 5, 'lb')
ON CONFLICT DO NOTHING;

-- Act: Complete the production run first time
SELECT complete_production_run('20000000-0000-0000-0000-000000000030', 10, 'lb', '[]'::jsonb);

-- Capture state after first completion
DO $$
DECLARE
  v_flour_stock_after_first NUMERIC;
  v_output_stock_after_first NUMERIC;
  v_transfer_count_after_first BIGINT;
BEGIN
  SELECT current_stock INTO v_flour_stock_after_first FROM products WHERE id = '20000000-0000-0000-0000-000000000010';
  SELECT current_stock INTO v_output_stock_after_first FROM products WHERE id = '20000000-0000-0000-0000-000000000011';
  SELECT count(*) INTO v_transfer_count_after_first
  FROM inventory_transactions
  WHERE reference_id LIKE '20000000-0000-0000-0000-000000000030_%'
  AND transaction_type = 'transfer';

  PERFORM set_config('test.flour_stock_after_first', v_flour_stock_after_first::text, false);
  PERFORM set_config('test.output_stock_after_first', v_output_stock_after_first::text, false);
  PERFORM set_config('test.transfer_count_after_first', v_transfer_count_after_first::text, false);
END $$;

-- Verify first completion worked
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000010'),
  45::numeric,
  'After first completion: flour stock reduced by 5 lb (50 -> 45)'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000011'),
  10::numeric,
  'After first completion: output product increased by 10 lb'
);

-- Act: Call complete_production_run a second time (should be no-op due to status check)
SELECT complete_production_run('20000000-0000-0000-0000-000000000030', 10, 'lb', '[]'::jsonb);

-- Assert: Stock levels unchanged after second call
SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000010'),
  current_setting('test.flour_stock_after_first')::numeric,
  'Idempotency: flour stock unchanged after second complete call'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '20000000-0000-0000-0000-000000000011'),
  current_setting('test.output_stock_after_first')::numeric,
  'Idempotency: output stock unchanged after second complete call'
);

-- Assert: No duplicate transactions created
SELECT is(
  (SELECT count(*)::bigint FROM inventory_transactions
   WHERE reference_id LIKE '20000000-0000-0000-0000-000000000030_%'
   AND transaction_type = 'transfer'),
  current_setting('test.transfer_count_after_first')::bigint,
  'Idempotency: no duplicate transfer transactions after second complete call'
);

-- Assert: Production run still shows completed status
SELECT is(
  (SELECT status FROM production_runs WHERE id = '20000000-0000-0000-0000-000000000030'),
  'completed',
  'Production run remains in completed status'
);

SELECT * FROM finish();
ROLLBACK;
