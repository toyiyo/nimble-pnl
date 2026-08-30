-- Tests get_inventory_usage_by_day (dashboard COGS per-day rollup).
-- The RPC runs as SECURITY INVOKER: RLS on inventory_transactions scopes the
-- caller, so a non-member sees zero rows rather than an error.
--
-- Assertions:
--   1. Per-row ABS: -10 and +2 on one day give food_cost 12, not 8. The
--      rows carry created_at in September but transaction_date '2026-04-05':
--      transaction_date drives the bucket and the filter.
--   2. A NULL transaction_date falls back to created_at (UTC). A purchase
--      row in the same month is excluded.
--   3. Boundary: a NULL-transaction_date usage row at 23:59:59.999 UTC on
--      the end day contributes.
--   4. An empty range returns zero rows without an error.
--   5. Tenancy: a non-member under authenticated gets zero rows for a
--      foreign restaurant.
--   6. The anon role has no EXECUTE privilege.

BEGIN;
SELECT plan(6);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000260'::uuid, 'usage-day-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000261'::uuid, 'Usage By Day Test Restaurant'),
  ('00000000-0000-0000-0000-000000000262'::uuid, 'Usage By Day Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant, not the foreign one.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000260'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO products (id, restaurant_id, sku, name) VALUES
  ('00000000-0000-0000-0000-000000000263'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid, 'USAGE-DAY-SKU-1', 'Usage By Day Test Product'),
  ('00000000-0000-0000-0000-000000000264'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid, 'USAGE-DAY-SKU-2', 'Usage By Day Foreign Product')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Restaurant 261, April: two usage rows on transaction_date '2026-04-05'.
--   Both rows carry created_at in September: transaction_date must win.
-- Restaurant 261, May: a NULL-transaction_date usage row (created_at drives
--   the bucket) plus a purchase row that must not count.
-- Restaurant 261, June: a NULL-transaction_date usage row at the
--   23:59:59.999 end-of-day boundary.
-- Restaurant 261, July: no rows at all.
-- Restaurant 262, June: a usage row a non-member must not see.
INSERT INTO inventory_transactions
  (id, restaurant_id, product_id, transaction_type, quantity, total_cost, transaction_date, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000265'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -10, -10, '2026-04-05'::date, '2026-09-15 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000266'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', 2, 2, '2026-04-05'::date, '2026-09-15 11:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000267'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -7, -7, NULL, '2026-05-10 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000268'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'usage', -50, -50, NULL, '2026-06-30 23:59:59.999+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000269'::uuid,
   '00000000-0000-0000-0000-000000000262'::uuid,
   '00000000-0000-0000-0000-000000000264'::uuid,
   'usage', -75, -75, '2026-06-15'::date, '2026-06-15 10:00:00+00'::timestamptz),
  ('00000000-0000-0000-0000-000000000270'::uuid,
   '00000000-0000-0000-0000-000000000261'::uuid,
   '00000000-0000-0000-0000-000000000263'::uuid,
   'purchase', 100, 500, '2026-05-20'::date, '2026-05-20 10:00:00+00'::timestamptz)
ON CONFLICT (id) DO UPDATE SET
  transaction_type = EXCLUDED.transaction_type,
  total_cost = EXCLUDED.total_cost,
  transaction_date = EXCLUDED.transaction_date,
  created_at = EXCLUDED.created_at;

-- Run as the real caller role, authenticated, with RLS active.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000260","role":"authenticated"}';

-- Test 1: per-row ABS and transaction_date precedence.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  $$ VALUES ('2026-04-05'::date, 12::numeric) $$,
  'A -10 row and a +2 row give food_cost 12 (per-row ABS); transaction_date drives the bucket'
);

-- Test 2: NULL transaction_date falls back to created_at; purchase excluded.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-05-01'::date, '2026-05-31'::date) $$,
  $$ VALUES ('2026-05-10'::date, 7::numeric) $$,
  'A NULL transaction_date row buckets by created_at; the purchase row is excluded'
);

-- Test 3: boundary. 23:59:59.999 UTC on the end day contributes.
SELECT results_eq(
  $$ SELECT day, food_cost FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  $$ VALUES ('2026-06-30'::date, 50::numeric) $$,
  'A NULL transaction_date row at 23:59:59.999 UTC on the end day is included'
);

-- Test 4: an empty range returns zero rows without an error.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000261'::uuid,
       '2026-07-01'::date, '2026-07-31'::date) $$,
  'An empty range returns zero rows without an error'
);

-- Test 5: tenancy. A non-member gets zero rows for a foreign restaurant.
SELECT is_empty(
  $$ SELECT * FROM get_inventory_usage_by_day(
       '00000000-0000-0000-0000-000000000262'::uuid,
       '2026-06-01'::date, '2026-06-30'::date) $$,
  'A non-member gets zero rows for a foreign restaurant'
);

RESET ROLE;
RESET request.jwt.claims;

-- Test 6: the anon role has no EXECUTE privilege.
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_inventory_usage_by_day(uuid,date,date)', 'EXECUTE'),
  'The anon role has no EXECUTE privilege on get_inventory_usage_by_day'
);

SELECT * FROM finish();
ROLLBACK;
