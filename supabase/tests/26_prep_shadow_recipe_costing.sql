-- Prep Shadow-Recipe Costing Tests
-- Covers migration 20260705000000_fix_prep_shadow_recipe_costing.sql, in the
-- order the sections below actually run:
-- 1. Self-heal: production run deducts + costs even when shadow recipe is inactive
-- 2. Idempotency (completed run): early return, no double deduction
-- 3. Idempotency (in_progress retry with existing transactions): no exception
-- 4. Loud failure: prep has ingredients but deduction yields none -> exception
-- 5. Data repair UPDATE reactivates prep-linked inactive recipes
-- 6. Backstop trigger blocks deactivating prep-linked recipes

BEGIN;
SELECT plan(16);

-- ============================================================
-- Setup: auth context, restaurant, membership
-- ============================================================
SELECT set_config('request.jwt.claims', '{"sub":"26000000-0000-0000-0000-0000000000ab","role":"authenticated"}', true);
INSERT INTO auth.users (id, email) VALUES ('26000000-0000-0000-0000-0000000000ab', 'shadow-recipe-test@example.com') ON CONFLICT DO NOTHING;
INSERT INTO restaurants (id, name) VALUES ('26000000-0000-0000-0000-000000000001', 'Shadow Recipe Test Restaurant') ON CONFLICT DO NOTHING;
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('26000000-0000-0000-0000-0000000000ab', '26000000-0000-0000-0000-000000000001', 'owner')
ON CONFLICT DO NOTHING;

-- Products: mix ($24.40/case of 5 gal) and pans output (container of 2.5 gal)
INSERT INTO products (id, restaurant_id, sku, name, uom_purchase, size_value, size_unit, cost_per_unit, current_stock)
VALUES
  ('26000000-0000-0000-0000-000000000010', '26000000-0000-0000-0000-000000000001', 'MIX-CASE', 'Ice Cream Mix 14%', 'case', 5, 'gal', 24.40, 75),
  ('26000000-0000-0000-0000-000000000011', '26000000-0000-0000-0000-000000000001', 'PANS-CT',  'Sweet Cream Pans',  'container', 2.5, 'gal', 0, 0)
ON CONFLICT (id) DO NOTHING;

-- INCIDENT STATE: shadow recipe inserted ALREADY INACTIVE (bypasses the new
-- backstop trigger, which only guards true->false UPDATE flips). Use DO
-- UPDATE (not DO NOTHING) so this fixture's is_active=false is always
-- (re-)applied even if a prior non-rolled-back run left this row active --
-- otherwise Section 1's self-heal assertions would silently test the wrong
-- starting state.
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000100', '26000000-0000-0000-0000-000000000001', 'Sweet Cream Pans Prep', 2, false)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO recipe_ingredients (recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000100', '26000000-0000-0000-0000-000000000010', 2.5, 'gal')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('26000000-0000-0000-0000-000000000020', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000100', 'Sweet Cream Pans Prep', 2, 'container', '26000000-0000-0000-0000-000000000011')
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipe_ingredients (prep_recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000020', '26000000-0000-0000-0000-000000000010', 2.5, 'gal')
ON CONFLICT DO NOTHING;

-- ============================================================
-- Section 1: Self-heal — inactive shadow recipe still deducts + costs
-- 2.5 gal of a 5-gal case = 0.5 case = $12.20; output 2 containers @ $6.10
-- ============================================================
INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('26000000-0000-0000-0000-000000000030', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000020', 'in_progress', 2, 'container', '26000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

INSERT INTO production_run_ingredients (id, production_run_id, product_id, expected_quantity, actual_quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000040', '26000000-0000-0000-0000-000000000030', '26000000-0000-0000-0000-000000000010', 2.5, 2.5, 'gal')
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Self-heal: run completes with inactive shadow recipe'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Self-heal: mix stock deducted 75 -> 74.5 (0.5 case)'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  2::numeric,
  'Self-heal: output stock 0 -> 2 containers'
);

SELECT is(
  (SELECT cost_per_unit::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  6.10::numeric,
  'Self-heal: output cost_per_unit $6.10 ($12.20 / 2)'
);

SELECT is(
  (SELECT actual_total_cost::numeric FROM production_runs WHERE id = '26000000-0000-0000-0000-000000000030'),
  12.20::numeric,
  'Self-heal: run actual_total_cost $12.20'
);

SELECT is(
  (SELECT COUNT(*) FROM inventory_transactions
   WHERE reference_id LIKE '26000000-0000-0000-0000-000000000030_%'
   AND product_id = '26000000-0000-0000-0000-000000000010'
   AND transaction_type = 'transfer' AND quantity < 0),
  1::bigint,
  'Self-heal: mix deduction transaction exists'
);

-- ============================================================
-- Section 2: Idempotency path 1 — re-completing a completed run is a no-op
-- ============================================================
SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Idempotency: re-completing a completed run does not error'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Idempotency: no double deduction on completed-run retry'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  2::numeric,
  'Idempotency: output stock not doubled on completed-run retry'
);

-- ============================================================
-- Section 3: Idempotency path 2 — in_progress retry whose transactions exist
-- (simulates a retry after partial failure: deduction committed, status not
-- yet flipped). already_processed short-circuit must NOT trip the new guard.
-- ============================================================
UPDATE production_runs SET status = 'in_progress', completed_at = NULL
WHERE id = '26000000-0000-0000-0000-000000000030';

SELECT lives_ok(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000030', 2, 'container', '[]'::jsonb)$$,
  'Idempotency: in_progress retry with existing transactions does not raise the deduction guard'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000010'),
  74.5::numeric,
  'Idempotency: still no double deduction after in_progress retry'
);

SELECT is(
  (SELECT current_stock::numeric FROM products WHERE id = '26000000-0000-0000-0000-000000000011'),
  2::numeric,
  'Idempotency: output stock still not doubled after in_progress retry'
);

-- ============================================================
-- Section 4: Loud failure — prep expects ingredients, shadow list is empty
-- ============================================================
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000101', '26000000-0000-0000-0000-000000000001', 'Desynced Prep', 1, true)
ON CONFLICT DO NOTHING;
-- NOTE: no recipe_ingredients rows for this recipe (the shadow-side desync).

INSERT INTO prep_recipes (id, restaurant_id, recipe_id, name, default_yield, default_yield_unit, output_product_id)
VALUES ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000101', 'Desynced Prep', 1, 'unit', NULL)
ON CONFLICT DO NOTHING;

INSERT INTO prep_recipe_ingredients (prep_recipe_id, product_id, quantity, unit)
VALUES ('26000000-0000-0000-0000-000000000021', '26000000-0000-0000-0000-000000000010', 1, 'gal')
ON CONFLICT DO NOTHING;

INSERT INTO production_runs (id, restaurant_id, prep_recipe_id, status, target_yield, target_yield_unit, created_by)
VALUES ('26000000-0000-0000-0000-000000000031', '26000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000021', 'in_progress', 1, 'unit', '26000000-0000-0000-0000-0000000000ab')
ON CONFLICT DO NOTHING;

SELECT throws_like(
  $$SELECT complete_production_run('26000000-0000-0000-0000-000000000031', 1, 'unit', '[]'::jsonb)$$,
  '%no ingredients were deducted%',
  'Loud failure: desynced shadow ingredient list raises instead of completing at $0'
);

-- ============================================================
-- Section 5: Data repair — reactivates prep-linked inactive recipes
-- (re-run the same statement the migration executes)
-- ============================================================
UPDATE recipes r
SET is_active = true, updated_at = now()
FROM prep_recipes pr
WHERE pr.recipe_id = r.id AND r.is_active = false;

SELECT is(
  (SELECT is_active FROM recipes WHERE id = '26000000-0000-0000-0000-000000000100'),
  true,
  'Data repair: prep-linked inactive shadow recipe reactivated'
);

-- ============================================================
-- Section 6: Backstop trigger
-- ============================================================
SELECT throws_like(
  $$UPDATE recipes SET is_active = false WHERE id = '26000000-0000-0000-0000-000000000100'$$,
  '%cannot be deactivated%',
  'Backstop: deactivating a prep-linked recipe is blocked'
);

-- Non-linked recipe can still be deactivated
INSERT INTO recipes (id, restaurant_id, name, serving_size, is_active)
VALUES ('26000000-0000-0000-0000-000000000102', '26000000-0000-0000-0000-000000000001', 'Plain Menu Recipe', 1, true)
ON CONFLICT DO NOTHING;

SELECT lives_ok(
  $$UPDATE recipes SET is_active = false WHERE id = '26000000-0000-0000-0000-000000000102'$$,
  'Backstop: non-linked recipe soft-delete still works'
);

SELECT * FROM finish();
ROLLBACK;
