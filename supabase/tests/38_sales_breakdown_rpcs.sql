-- Tests get_sales_by_category and get_top_sold_items (cluster 2 aggregates).
-- Both RPCs run as SECURITY INVOKER: RLS on unified_sales scopes the caller
-- (spec §8), so a non-member simply sees zero rows rather than an error.

BEGIN;
SELECT plan(6);

-- Fixtures insert as the session role (postgres, BYPASSRLS). RLS stays on.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000241'::uuid, 'sales-breakdown-member@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

SELECT
  '00000000-0000-0000-0000-000000000240'::uuid AS restaurant_id,
  '00000000-0000-0000-0000-000000000242'::uuid AS foreign_restaurant_id,
  '2026-04-01'::date AS date_from,
  '2026-04-30'::date AS date_to
\gset

-- Clean baseline
DELETE FROM unified_sales WHERE restaurant_id IN (:'restaurant_id', :'foreign_restaurant_id');
DELETE FROM chart_of_accounts WHERE restaurant_id = :'restaurant_id';

INSERT INTO restaurants (id, name) VALUES
  (:'restaurant_id', 'Sales Breakdown Test'),
  (:'foreign_restaurant_id', 'Sales Breakdown Foreign Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The member belongs only to the primary restaurant.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000241'::uuid, :'restaurant_id', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Two revenue categories.
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000611', :'restaurant_id', '4000', 'Food Sales', 'revenue', 'food_sales', 'credit'),
  ('00000000-0000-0000-0000-000000000612', :'restaurant_id', '4100', 'Beverage Sales', 'revenue', 'beverage_sales', 'credit')
ON CONFLICT DO NOTHING;

-- Fixture for tests 1 and 2: two categorized sales ($100 Food, $30
-- Beverage), one uncategorized sale ($20), a tax-adjustment row ($8, in
-- Food), and a split parent ($40) + child ($15) pair (both in Food). The
-- tax row and the split parent must not contribute to Food Sales revenue;
-- the split child (it has no child of its own) must still count.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000711', :'restaurant_id', 'test', 'ord-1', 'item-1',
    'Burger', 1, 100, 100, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, NULL),
  ('00000000-0000-0000-0000-000000000712', :'restaurant_id', 'test', 'ord-2', 'item-2',
    'Soda', 1, 30, 30, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000612', NULL, NULL),
  ('00000000-0000-0000-0000-000000000713', :'restaurant_id', 'test', 'ord-3', 'item-3',
    'Uncategorized Item', 1, 20, 20, '2026-04-15', 'sale', false,
    NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000714', :'restaurant_id', 'test', 'ord-4', 'item-4',
    'POS Sales Tax', 1, 8, 8, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000611', 'tax', NULL),
  ('00000000-0000-0000-0000-000000000715', :'restaurant_id', 'test', 'ord-5', 'item-5',
    'Split Parent', 1, 40, 40, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, NULL),
  ('00000000-0000-0000-0000-000000000716', :'restaurant_id', 'test', 'ord-5', 'item-5-split',
    'Split Child', 1, 15, 15, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, '00000000-0000-0000-0000-000000000715');

-- Test 1: get_sales_by_category runs without error.
SELECT lives_ok(
  $$ SELECT * FROM get_sales_by_category(
       '00000000-0000-0000-0000-000000000240'::uuid,
       '2026-04-01'::date, '2026-04-30'::date) $$,
  'get_sales_by_category runs without error'
);

-- Test 2: it groups the categorized and uncategorized sales into the right
-- buckets, and excludes the adjustment_type='tax' row and the split parent
-- row. Food Sales = 100 (Burger) + 15 (split child); the 8 tax row and the
-- 40 split parent are both left out.
SELECT is(
  (SELECT STRING_AGG(category_name || ':' || revenue::numeric(10,2)::text, ',' ORDER BY revenue DESC)
   FROM get_sales_by_category(:'restaurant_id', :'date_from', :'date_to')),
  'Food Sales:115.00,Beverage Sales:30.00,Uncategorized:20.00',
  'get_sales_by_category groups sales into the right buckets and excludes a tax row and a split parent row'
);

-- Fixture for tests 3 and 4: three distinct items with descending revenue.
DELETE FROM unified_sales WHERE restaurant_id = :'restaurant_id';

INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000721', :'restaurant_id', 'test', 'ord-t1', 'item-t1',
    'Top Item A', 1, 300, 300, '2026-04-16', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, NULL),
  ('00000000-0000-0000-0000-000000000722', :'restaurant_id', 'test', 'ord-t2', 'item-t2',
    'Top Item B', 1, 200, 200, '2026-04-16', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, NULL),
  ('00000000-0000-0000-0000-000000000723', :'restaurant_id', 'test', 'ord-t3', 'item-t3',
    'Top Item C', 1, 100, 100, '2026-04-16', 'sale', true,
    '00000000-0000-0000-0000-000000000611', NULL, NULL);

-- Test 3: get_top_sold_items orders by revenue and honors p_limit.
SELECT results_eq(
  $$ SELECT item_name FROM get_top_sold_items(
       '00000000-0000-0000-0000-000000000240'::uuid,
       '2026-04-01'::date, '2026-04-30'::date, 2) $$,
  $$ VALUES ('Top Item A'::text), ('Top Item B'::text) $$,
  'get_top_sold_items orders by revenue and honors p_limit => 2, top first'
);

-- A foreign restaurant's row must never contribute to the caller's totals.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000731', :'foreign_restaurant_id', 'test', 'ord-f1', 'item-f1',
    'Foreign Item', 1, 500, 500, '2026-04-16', 'sale', false,
    NULL, NULL, NULL);

-- Test 4: the second restaurant's row does not contribute (still 3 rows,
-- not 4, and the foreign $500 item never outranks the caller's own items).
SELECT is(
  (SELECT COUNT(*)::int FROM get_top_sold_items(:'restaurant_id', :'date_from', :'date_to', 10)),
  3,
  'a second restaurant''s rows never contribute to get_top_sold_items'
);

-- Test 5: tenancy. A non-member sees zero rows for the foreign restaurant.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000241","role":"authenticated"}';

SELECT is(
  (SELECT COUNT(*)::int FROM get_sales_by_category(:'foreign_restaurant_id', :'date_from', :'date_to')),
  0,
  'a non-member sees zero rows for the foreign restaurant (RLS scopes the caller)'
);

RESET ROLE;
RESET request.jwt.claims;

-- Test 6: the anon role cannot EXECUTE the function.
SELECT is(
  has_function_privilege(
    'anon',
    'public.get_sales_by_category(uuid,date,date)',
    'EXECUTE'),
  false,
  'anon cannot EXECUTE get_sales_by_category'
);

SELECT * FROM finish();
ROLLBACK;
