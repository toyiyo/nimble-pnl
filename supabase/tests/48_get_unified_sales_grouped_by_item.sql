-- Tests for get_unified_sales_grouped_by_item.
-- Restaurant UUID …0097 to avoid colliding with 35_/37_ fixtures.
BEGIN;
SELECT plan(18);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'grp-member@example.com'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'grp-nonmember@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000097'::uuid, 'Grouped Test Restaurant', '1 Group St', '555-0097')
ON CONFLICT (id) DO UPDATE SET name = 'Grouped Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000097'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Seed rows on 2024-08-01:
--   Burger x2 @ 10 (two sales, qty 3 total, revenue 20)
--   Fries  x1 @ 5  (revenue 5)
--   Soda   x1 with NULL total_price (revenue must COALESCE to 0)
--   Burger child split (parent_sale_id set) → excluded
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id, parent_sale_id) VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-1','Burger',2,10.00,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b2'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-2','Burger',1,10.00,'2024-08-01',true,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b3'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-3','Fries',1,5.00,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b4'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-4','Soda',1,NULL,'2024-08-01',false,NULL,NULL),
  ('00000000-0000-0000-0000-0000000000b5'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-5','Burger',1,3.00,'2024-08-01',false,NULL,'00000000-0000-0000-0000-0000000000b1'::uuid)
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, is_categorized = EXCLUDED.is_categorized, parent_sale_id = EXCLUDED.parent_sale_id;

-- Recipe mapping for Burger only (case-insensitive check on pos_item_name)
INSERT INTO recipes (id, restaurant_id, name, pos_item_name) VALUES
  ('00000000-0000-0000-0000-0000000000e1'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'Burger Recipe','burger')
ON CONFLICT (id) DO UPDATE SET pos_item_name = 'burger';

-- A chart_of_accounts row to satisfy the FK on suggested_category_id
INSERT INTO chart_of_accounts (id, restaurant_id, account_name, account_type, account_code, normal_balance)
VALUES (
  '00000000-0000-0000-0000-0000000000c0'::uuid,
  '00000000-0000-0000-0000-000000000097'::uuid,
  'Grp Test Food', 'expense', '5001-grp-test', 'debit'
)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, account_type = EXCLUDED.account_type, account_code = EXCLUDED.account_code, normal_balance = EXCLUDED.normal_balance;

-- Pizza on a separate date (2024-08-02): is_categorized=false, suggested_category_id
-- SET → pending-review, not uncategorized. No recipe mapping (without-recipe).
-- Kept off 2024-08-01 so it doesn't shift the Tests 1/6-8 fixtures above.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id, parent_sale_id) VALUES
  ('00000000-0000-0000-0000-0000000000b6'::uuid,'00000000-0000-0000-0000-000000000097'::uuid,'manual','g-6','Pizza',5,8.00,'2024-08-02',false,'00000000-0000-0000-0000-0000000000c0'::uuid,NULL)
ON CONFLICT (id) DO UPDATE SET item_name = EXCLUDED.item_name, quantity = EXCLUDED.quantity, total_price = EXCLUDED.total_price, is_categorized = EXCLUDED.is_categorized, suggested_category_id = EXCLUDED.suggested_category_id, parent_sale_id = EXCLUDED.parent_sale_id;

-- Test 1: three distinct groups (child split excluded)
SELECT is(
  (SELECT COUNT(*)::int FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01')),
  3,
  'returns one row per distinct item_name, child split excluded'
);

-- Test 2: Burger revenue = 20 (10+10), child 3.00 excluded
SELECT is(
  (SELECT total_revenue FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  20.00::numeric,
  'Burger revenue sums parents only (child split excluded)'
);

-- Test 3: Burger quantity = 3 (2+1)
SELECT is(
  (SELECT total_quantity FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  3::numeric,
  'Burger quantity sums parents only'
);

-- Test 4: Burger sale_count = 2
SELECT is(
  (SELECT sale_count FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Burger'),
  2::bigint,
  'Burger sale_count counts parent rows only'
);

-- Test 5: Soda NULL total_price coalesces to 0 (not NULL)
SELECT is(
  (SELECT total_revenue FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') WHERE item_name = 'Soda'),
  0::numeric,
  'NULL total_price group coalesces revenue to 0'
);

-- Test 6: sort by revenue desc → Burger(20), Fries(5), Soda(0)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','revenue','desc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by revenue desc orders groups by aggregate'
);

-- Test 7: sort by revenue asc → Soda(0), Fries(5), Burger(20)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','revenue','asc')),
  ARRAY['Soda','Fries','Burger'],
  'sort by revenue asc reverses order'
);

-- Test 8: sort by name asc → Burger, Fries, Soda
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','name','asc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by name asc orders alphabetically'
);

-- Test 9: recipe filter with-recipe → only Burger
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','with-recipe','name','asc')),
  ARRAY['Burger'],
  'with-recipe filter matches recipes.pos_item_name case-insensitively'
);

-- Test 10: categorization filter categorized → only the categorized Burger row (revenue 10, count 1)
SELECT is(
  (SELECT sale_count FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'categorized','all','name','asc') WHERE item_name = 'Burger'),
  1::bigint,
  'categorized filter keeps only is_categorized IS TRUE rows'
);

-- Test 11: sort by quantity desc → Burger(3), then Fries/Soda tied at 1
-- (deterministic tie-break: the RPC's unconditional trailing `item_name ASC`
-- orders the tied pair alphabetically regardless of p_sort_direction).
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','quantity','desc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by quantity desc orders by aggregate, ties broken by name asc'
);

-- Test 12: sort by quantity asc → Fries/Soda tied at 1 (name asc), then Burger(3)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','quantity','asc')),
  ARRAY['Fries','Soda','Burger'],
  'sort by quantity asc reverses aggregate order, ties still broken by name asc'
);

-- Test 13: sort by sales (count) desc → Burger(2), then Fries/Soda tied at 1
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','sales','desc')),
  ARRAY['Burger','Fries','Soda'],
  'sort by sales desc orders by sale_count, ties broken by name asc'
);

-- Test 14: sort by name desc → Soda, Fries, Burger
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01',NULL,'all','all','name','desc')),
  ARRAY['Soda','Fries','Burger'],
  'sort by name desc orders reverse-alphabetically'
);

-- Test 15: without-recipe filter (range covers both dates) → Fries, Pizza, Soda
-- (Burger excluded — it has a recipe mapping)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-02',NULL,'all','without-recipe','name','asc')),
  ARRAY['Fries','Pizza','Soda'],
  'without-recipe filter excludes items with a recipes.pos_item_name match'
);

-- Test 16: uncategorized filter (range covers both dates) → Burger, Fries, Soda
-- (Pizza excluded — it has suggested_category_id set, so it's pending-review)
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-02',NULL,'uncategorized','all','name','asc')),
  ARRAY['Burger','Fries','Soda'],
  'uncategorized filter excludes rows with suggested_category_id set'
);

-- Test 17: pending-review filter (range covers both dates) → only Pizza
SELECT is(
  (SELECT array_agg(item_name) FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-02',NULL,'pending-review','all','name','asc')),
  ARRAY['Pizza'],
  'pending-review filter keeps only is_categorized IS NOT TRUE AND suggested_category_id IS NOT NULL rows'
);

-- Test 18: non-member call raises Access denied
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000002"}';
SELECT throws_ok(
  $$ SELECT * FROM get_unified_sales_grouped_by_item('00000000-0000-0000-0000-000000000097'::uuid,'2024-08-01','2024-08-01') $$,
  'Access denied to restaurant',
  'non-member call raises Access denied'
);

SELECT * FROM finish();
ROLLBACK;
