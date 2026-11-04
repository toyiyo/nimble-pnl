-- Tests get_inventory_usage_by_month (cluster 3, COGS aggregate).
-- The RPC runs as SECURITY INVOKER: RLS on inventory_transactions scopes the
-- caller (spec §1.3/§5.4), so a non-member simply sees zero rows rather than
-- an error.
--
-- Assertions:
--   1. Two usage rows in one month sum with ABS(SUM()) semantics: -10 and +2
--      give food_cost 8, not 12.
--   2. A non-usage row (transaction_type = 'purchase') is excluded.
--   3. Boundary: a usage row late on the END day
--      (created_at = (p_end_date || ' 21:00:00+00')::timestamptz) contributes.
--   4. An empty month range returns zero rows without an error.
--   5. Tenancy: a non-member under authenticated gets zero rows for a
--      foreign restaurant.

BEGIN;
SELECT plan(5);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000251'::uuid, 'inv-usage-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000250'::uuid, 'Inventory Usage Test Restaurant'),
  ('00000000-0000-0000-0000-000000000252'::uuid, 'Inventory Usage Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000251'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO products (id, restaurant_id, sku, name) VALUES
  ('00000000-0000-0000-0000-000000000253'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid, 'INV-USAGE-SKU-1', 'Inventory Usage Test Product'),
  ('00000000-0000-0000-0000-000000000254'::uuid,
   '00000000-0000-0000-0000-000000000252'::uuid, 'INV-USAGE-SKU-2', 'Inventory Usage Foreign Product')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Restaurant 250, April: a usage row and a reversal usage row (assertion 1).
-- Restaurant 250, May: a purchase-only row (assertion 2).
-- Restaurant 250, June: a usage row late on the end day (assertion 3).
-- Restaurant 250, July: no rows at all (assertion 4).
-- Restaurant 252, June: a usage row a non-member must not see (assertion 5).
INSERT INTO inventory_transactions
  (id, restaurant_id, product_id, transaction_type, quantity, total_cost, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000255'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid,
   '00000000-0000-0000-0000-000000000253'::uuid,
   'usage', -10, -10, '2026-04-05 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000256'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid,
   '00000000-0000-0000-0000-000000000253'::uuid,
   'usage', 2, 2, '2026-04-06 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000257'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid,
   '00000000-0000-0000-0000-000000000253'::uuid,
   'purchase', 100, 500, '2026-05-10 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000258'::uuid,
   '00000000-0000-0000-0000-000000000250'::uuid,
   '00000000-0000-0000-0000-000000000253'::uuid,
   'usage', -50, -50, ('2026-06-30' || ' 21:00:00+00')::timestamptz),
  ('00000000-0000-0000-0000-000000000259'::uuid,
   '00000000-0000-0000-0000-000000000252'::uuid,
   '00000000-0000-0000-0000-000000000254'::uuid,
   'usage', -75, -75, '2026-06-15 10:00:00+00'::timestamptz)
ON CONFLICT (id) DO UPDATE SET
  transaction_type = EXCLUDED.transaction_type,
  total_cost = EXCLUDED.total_cost,
  created_at = EXCLUDED.created_at;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000251","role":"authenticated"}';

-- Test 1: two usage rows in one month sum with ABS(SUM()) semantics.
SELECT results_eq(
  $$ SELECT period, food_cost FROM get_inventory_usage_by_month(
       '00000000-0000-0000-0000-000000000250'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  $$ VALUES ('2026-04'::text, 8::numeric) $$,
  'A -10 usage row and a +2 reversal row give food_cost 8, not 12'
);

-- Test 2: a non-usage row (purchase) is excluded.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_month(
       '00000000-0000-0000-0000-000000000250'::uuid,
       '2026-05-01'::date, '2026-05-31'::date) $$,
  'A purchase-type row is excluded: a month with only a purchase returns no rows'
);

-- Test 3: boundary. A usage row late on the END day contributes.
SELECT results_eq(
  $$ SELECT period, food_cost FROM get_inventory_usage_by_month(
       '00000000-0000-0000-0000-000000000250'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  $$ VALUES ('2026-06'::text, 50::numeric) $$,
  'A usage row at 21:00 UTC on the end day is included in the month sum'
);

-- Test 4: an empty month range returns zero rows without an error.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_month(
       '00000000-0000-0000-0000-000000000250'::uuid,
       '2026-07-01'::date, '2026-07-31'::date) $$,
  'An empty month range returns zero rows without an error'
);

-- Test 5: tenancy. A non-member gets zero rows for a foreign restaurant.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_month(
       '00000000-0000-0000-0000-000000000252'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  'A non-member gets zero rows for a foreign restaurant'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
