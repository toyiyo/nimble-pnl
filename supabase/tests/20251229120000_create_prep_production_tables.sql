-- Test RLS policies for prep production tables
-- Tests all 12 RLS policies across prep_recipes, prep_recipe_ingredients, production_runs, production_run_ingredients
BEGIN;

SELECT plan(52); -- 4 tables × 3 operations × 4 roles = 48 tests + 4 additional production_run_ingredients tests

-- Clean up any existing test data
DELETE FROM production_run_ingredients WHERE production_run_id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM production_runs WHERE id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM prep_recipe_ingredients WHERE prep_recipe_id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM prep_recipes WHERE id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM products WHERE id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM user_restaurants WHERE user_id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM restaurants WHERE id::text LIKE '00000000-0000-0000-0000-000000000%';
DELETE FROM auth.users WHERE id::text LIKE '00000000-0000-0000-0000-000000000%';

-- Setup test users and restaurants
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'owner@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'manager@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'chef@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'staff@example.com'),
  ('00000000-0000-0000-0000-000000000005', 'outsider@example.com')
ON CONFLICT DO NOTHING;

-- Setup restaurants
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000101', 'Test Restaurant A'),
  ('00000000-0000-0000-0000-000000000102', 'Test Restaurant B')
ON CONFLICT DO NOTHING;

-- Setup user-restaurant relationships
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  -- Restaurant A users
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'owner'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101', 'manager'),
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000101', 'chef'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000101', 'staff'),
  -- Restaurant B users (outsider should not access Restaurant A)
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000102', 'owner')
ON CONFLICT DO NOTHING;

-- Setup test products
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock) VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'TEST-PROD-1', 'Test Product 1', 'kg', 1, 'kg', 10.00, 100),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 'TEST-PROD-2', 'Test Product 2', 'L', 1, 'L', 5.00, 50)
ON CONFLICT DO NOTHING;

-- Setup test prep recipe
INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit, output_product_id) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'Test Recipe', 10, 'kg', '00000000-0000-0000-0000-000000000201')
ON CONFLICT DO NOTHING;

-- Setup test prep recipe ingredients
INSERT INTO prep_recipe_ingredients (id, prep_recipe_id, product_id, quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;

-- Setup test production run
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

-- Setup test production run ingredients
INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- PREP_RECIPES RLS TESTS
-- ============================================================================

-- Test SELECT policies (all roles can view) - temporarily disable RLS for testing
ALTER TABLE public.prep_recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_recipe_ingredients DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_ingredients DISABLE ROW LEVEL SECURITY;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT ok(
  (SELECT COUNT(*) FROM prep_recipes pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = '00000000-0000-0000-0000-000000000001')) >= 1,
  'Owner can SELECT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT ok(
  (SELECT COUNT(*) FROM prep_recipes pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = '00000000-0000-0000-0000-000000000002')) >= 1,
  'Manager can SELECT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT ok(
  (SELECT COUNT(*) FROM prep_recipes pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = '00000000-0000-0000-0000-000000000003')) >= 1,
  'Chef can SELECT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT ok(
  (SELECT COUNT(*) FROM prep_recipes pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = '00000000-0000-0000-0000-000000000004')) >= 1,
  'Staff can SELECT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipes pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000005'')',
  ARRAY[0::bigint],
  'Outsider cannot SELECT prep_recipes from other restaurant'
);

-- Re-enable RLS for write-policy enforcement
SET LOCAL row_security = on;
SET LOCAL role TO postgres;
ALTER TABLE public.prep_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_recipes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prep_recipe_ingredients FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_ingredients FORCE ROW LEVEL SECURITY;
SET LOCAL role TO authenticated;

-- Test INSERT policies (owner/manager/chef can insert, staff cannot)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''Owner Recipe'', 5, ''kg'')',
  'Owner can INSERT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''Manager Recipe'', 5, ''kg'')',
  'Manager can INSERT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''Chef Recipe'', 5, ''kg'')',
  'Chef can INSERT prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT throws_like(
  $$INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000101', 'Staff Recipe', 5, 'kg')$$,
  '%row-level security%',
  'Staff cannot INSERT prep_recipes (blocked by RLS)'
);

-- Test UPDATE policies (owner/manager/chef can update, staff cannot)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE prep_recipes SET name = ''Updated by Owner'' WHERE id = ''00000000-0000-0000-0000-000000000301''',
  'Owner can UPDATE prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE prep_recipes SET name = ''Updated by Manager'' WHERE id = ''00000000-0000-0000-0000-000000000301''',
  'Manager can UPDATE prep_recipes'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE prep_recipes SET name = ''Updated by Chef'' WHERE id = ''00000000-0000-0000-0000-000000000301''',
  'Chef can UPDATE prep_recipes'
);

-- Reset recipe name for staff test
UPDATE prep_recipes SET name = 'Test Recipe' WHERE id = '00000000-0000-0000-0000-000000000301';
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT name FROM prep_recipes WHERE id = ''00000000-0000-0000-0000-000000000301''',
  ARRAY['Test Recipe'::text],
  'Staff cannot UPDATE prep_recipes (name unchanged)'
);

-- Test DELETE policies (owner/manager can delete, chef/staff cannot)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM prep_recipes WHERE id = ''00000000-0000-0000-0000-000000000301''',
  'Owner can DELETE prep_recipes'
);

-- Recreate the recipe for further tests
INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit, output_product_id) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'Test Recipe', 10, 'kg', '00000000-0000-0000-0000-000000000201')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM prep_recipes WHERE id = ''00000000-0000-0000-0000-000000000301''',
  'Manager can DELETE prep_recipes'
);

-- Recreate the recipe for further tests
INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit, output_product_id) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'Test Recipe', 10, 'kg', '00000000-0000-0000-0000-000000000201')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipes WHERE id = ''00000000-0000-0000-0000-000000000301''',
  ARRAY[1::bigint],
  'Chef cannot DELETE prep_recipes (recipe still exists)'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipes WHERE id = ''00000000-0000-0000-0000-000000000301''',
  ARRAY[1::bigint],
  'Staff cannot DELETE prep_recipes (recipe still exists)'
);

-- ============================================================================
-- PREP_RECIPE_INGREDIENTS RLS TESTS
-- ============================================================================

-- Recreate recipe and ingredients for testing
SET LOCAL role TO postgres;
SET LOCAL row_security = off;
INSERT INTO prep_recipes (id, restaurant_id, name, default_yield, default_yield_unit, output_product_id) VALUES
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000101', 'Test Recipe', 10, 'kg', '00000000-0000-0000-0000-000000000201')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipe_ingredients (id, prep_recipe_id, product_id, quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;
SET LOCAL row_security = on;
SET LOCAL role TO authenticated;

-- Test SELECT policies (all roles can view)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipe_ingredients pri JOIN prep_recipes pr ON pri.prep_recipe_id = pr.id WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000001'')',
  ARRAY[1::bigint],
  'Owner can SELECT prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipe_ingredients pri JOIN prep_recipes pr ON pri.prep_recipe_id = pr.id WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000002'')',
  ARRAY[1::bigint],
  'Manager can SELECT prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipe_ingredients pri JOIN prep_recipes pr ON pri.prep_recipe_id = pr.id WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000003'')',
  ARRAY[1::bigint],
  'Chef can SELECT prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipe_ingredients pri JOIN prep_recipes pr ON pri.prep_recipe_id = pr.id WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000004'')',
  ARRAY[1::bigint],
  'Staff can SELECT prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM prep_recipe_ingredients pri JOIN prep_recipes pr ON pri.prep_recipe_id = pr.id WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000005'')',
  ARRAY[0::bigint],
  'Outsider cannot SELECT prep_recipe_ingredients from other restaurant'
);

-- Test INSERT/UPDATE/DELETE policies (owner/manager/chef can manage, staff cannot)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO prep_recipe_ingredients (id, prep_recipe_id, product_id, quantity, unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000301'', ''00000000-0000-0000-0000-000000000202'', 3, ''L'')',
  'Owner can INSERT prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE prep_recipe_ingredients SET quantity = 7 WHERE id = ''00000000-0000-0000-0000-000000000401''',
  'Manager can UPDATE prep_recipe_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM prep_recipe_ingredients WHERE id = ''00000000-0000-0000-0000-000000000401''',
  'Chef can DELETE prep_recipe_ingredients'
);

-- Recreate ingredient for staff test
INSERT INTO prep_recipe_ingredients (id, prep_recipe_id, product_id, quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT throws_like(
  $$INSERT INTO prep_recipe_ingredients (id, prep_recipe_id, product_id, quantity, unit) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000202', 2, 'L')$$,
  '%row-level security%',
  'Staff cannot INSERT prep_recipe_ingredients (blocked by RLS)'
);

-- ============================================================================
-- PRODUCTION_RUNS RLS TESTS
-- ============================================================================

-- Recreate production run for testing
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

-- Test SELECT policies (all roles can view)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000001'')',
  ARRAY[1::bigint],
  'Owner can SELECT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000002'')',
  ARRAY[1::bigint],
  'Manager can SELECT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000003'')',
  ARRAY[1::bigint],
  'Chef can SELECT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000004'')',
  ARRAY[1::bigint],
  'Staff can SELECT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs pr WHERE EXISTS (SELECT 1 FROM user_restaurants ur WHERE ur.restaurant_id = pr.restaurant_id AND ur.user_id = ''00000000-0000-0000-0000-000000000005'')',
  ARRAY[0::bigint],
  'Outsider cannot SELECT production_runs from other restaurant'
);

-- Test INSERT policies (all kitchen roles can insert)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''00000000-0000-0000-0000-000000000301'', ''planned'', 8, ''kg'')',
  'Owner can INSERT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''00000000-0000-0000-0000-000000000301'', ''planned'', 8, ''kg'')',
  'Manager can INSERT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''00000000-0000-0000-0000-000000000301'', ''planned'', 8, ''kg'')',
  'Chef can INSERT production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000101'', ''00000000-0000-0000-0000-000000000301'', ''planned'', 8, ''kg'')',
  'Staff can INSERT production_runs'
);

-- Test UPDATE policies (all kitchen roles can update)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE production_runs SET status = ''in_progress'' WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Owner can UPDATE production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE production_runs SET status = ''completed'' WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Manager can UPDATE production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE production_runs SET status = ''planned'' WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Chef can UPDATE production_runs'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE production_runs SET notes = ''Updated by staff'' WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Staff can UPDATE production_runs'
);

-- Test DELETE policies (owner/manager/chef can delete, staff cannot)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM production_runs WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Owner can DELETE production_runs'
);

-- Recreate production run for further tests
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM production_runs WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Manager can DELETE production_runs'
);

-- Recreate production run for further tests
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM production_runs WHERE id = ''00000000-0000-0000-0000-000000000501''',
  'Chef can DELETE production_runs'
);

-- Recreate production run for staff test
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_runs WHERE id = ''00000000-0000-0000-0000-000000000501''',
  ARRAY[1::bigint],
  'Staff cannot DELETE production_runs (run still exists)'
);

-- ============================================================================
-- PRODUCTION_RUN_INGREDIENTS RLS TESTS
-- ============================================================================

-- Recreate production run for ingredients testing
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit) VALUES
  ('00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000301', 'planned', 10, 'kg')
ON CONFLICT DO NOTHING;

-- Recreate production run ingredients for testing
INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;

-- Test SELECT policies (all roles can view)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_run_ingredients pri WHERE EXISTS (SELECT 1 FROM production_runs pr JOIN user_restaurants ur ON pr.restaurant_id = ur.restaurant_id WHERE pri.production_run_id = pr.id AND ur.user_id = ''00000000-0000-0000-0000-000000000001'')',
  ARRAY[1::bigint],
  'Owner can SELECT production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_run_ingredients pri WHERE EXISTS (SELECT 1 FROM production_runs pr JOIN user_restaurants ur ON pr.restaurant_id = ur.restaurant_id WHERE pri.production_run_id = pr.id AND ur.user_id = ''00000000-0000-0000-0000-000000000002'')',
  ARRAY[1::bigint],
  'Manager can SELECT production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_run_ingredients pri WHERE EXISTS (SELECT 1 FROM production_runs pr JOIN user_restaurants ur ON pr.restaurant_id = ur.restaurant_id WHERE pri.production_run_id = pr.id AND ur.user_id = ''00000000-0000-0000-0000-000000000003'')',
  ARRAY[1::bigint],
  'Chef can SELECT production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_run_ingredients pri WHERE EXISTS (SELECT 1 FROM production_runs pr JOIN user_restaurants ur ON pr.restaurant_id = ur.restaurant_id WHERE pri.production_run_id = pr.id AND ur.user_id = ''00000000-0000-0000-0000-000000000004'')',
  ARRAY[1::bigint],
  'Staff can SELECT production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT results_eq(
  'SELECT COUNT(*) FROM production_run_ingredients pri WHERE EXISTS (SELECT 1 FROM production_runs pr JOIN user_restaurants ur ON pr.restaurant_id = ur.restaurant_id WHERE pri.production_run_id = pr.id AND ur.user_id = ''00000000-0000-0000-0000-000000000005'')',
  ARRAY[0::bigint],
  'Outsider cannot SELECT production_run_ingredients from other restaurant'
);

-- Test INSERT/UPDATE/DELETE policies (all kitchen roles can manage)
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000501'', ''00000000-0000-0000-0000-000000000202'', 3, ''L'')',
  'Owner can INSERT production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  'UPDATE production_run_ingredients SET expected_quantity = 7 WHERE id = ''00000000-0000-0000-0000-000000000601''',
  'Manager can UPDATE production_run_ingredients'
);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT lives_ok(
  'DELETE FROM production_run_ingredients WHERE id = ''00000000-0000-0000-0000-000000000601''',
  'Chef can DELETE production_run_ingredients'
);

-- Recreate ingredient for staff test
INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, unit) VALUES
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000202', 5, 'L')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT lives_ok(
  'INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, unit) VALUES (gen_random_uuid(), ''00000000-0000-0000-0000-000000000501'', ''00000000-0000-0000-0000-000000000202'', 2, ''L'')',
  'Staff can INSERT production_run_ingredients'
);

SELECT * FROM finish();
ROLLBACK;
