-- Tests for get_unified_sales_totals: uncategorized_count + pending_review_count
-- See sig:539980c1fe88. Distinct restaurant UUID (…0098) to avoid colliding
-- with 35_…sql (which uses …0099) so the two test files are order-independent.
BEGIN;
SELECT plan(7);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Members + non-member fixtures
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'cat-member@example.com'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'cat-nonmember@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000098'::uuid, 'Categorization Test Restaurant', '789 Pine St', '555-0098')
ON CONFLICT (id) DO UPDATE SET name = 'Categorization Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, '00000000-0000-0000-0000-000000000098'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- A chart_of_accounts row to satisfy the FK on suggested_category_id
INSERT INTO chart_of_accounts (id, restaurant_id, account_name, account_type, account_code, normal_balance)
VALUES (
  '00000000-0000-0000-0000-0000000000c0'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'Cat Test Food', 'expense', '5001-cat-test', 'debit'
)
ON CONFLICT (id) DO NOTHING;

-- Test 1: Empty fixture (no rows for restaurant on this date) → both counts 0
SELECT is(
  (SELECT uncategorized_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-01'::DATE, '2024-07-01'::DATE
  )),
  0::BIGINT,
  'uncategorized_count is 0 on empty fixture'
);

-- Seed rows scoped to 2024-07-02
-- Row A: is_categorized=false, suggested_category_id=NULL  → uncategorized
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a1'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-1', 'Item A', 1, 12.00, '2024-07-02', false, NULL
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, suggested_category_id = NULL, parent_sale_id = NULL;

-- Row B: is_categorized=NULL (legacy), suggested_category_id=NULL  → uncategorized
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a2'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-2', 'Item B', 1, 5.00, '2024-07-02', NULL, NULL
)
ON CONFLICT (id) DO UPDATE SET is_categorized = NULL, suggested_category_id = NULL, parent_sale_id = NULL;

-- Row C: is_categorized=false, suggested_category_id SET  → pending_review (NOT uncategorized)
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a3'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-3', 'Item C', 1, 7.50, '2024-07-02', false, '00000000-0000-0000-0000-0000000000c0'::uuid
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, suggested_category_id = '00000000-0000-0000-0000-0000000000c0'::uuid, parent_sale_id = NULL;

-- Row D: is_categorized=true  → excluded from both
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a4'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-4', 'Item D', 1, 20.00, '2024-07-02', true, NULL
)
ON CONFLICT (id) DO UPDATE SET is_categorized = true, suggested_category_id = NULL, parent_sale_id = NULL;

-- Row E: a child split (parent_sale_id NOT NULL)  → excluded from both
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id, parent_sale_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a5'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-5', 'Item E child', 1, 3.00, '2024-07-02', false, NULL, '00000000-0000-0000-0000-0000000000a1'::uuid
)
ON CONFLICT (id) DO UPDATE SET parent_sale_id = '00000000-0000-0000-0000-0000000000a1'::uuid, is_categorized = false, suggested_category_id = NULL;

-- Row F: out of date window (sale_date 2024-07-03)  → excluded by date filter
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, is_categorized, suggested_category_id)
VALUES (
  '00000000-0000-0000-0000-0000000000a6'::uuid,
  '00000000-0000-0000-0000-000000000098'::uuid,
  'manual', 'cat-order-6', 'Item F next day', 1, 4.00, '2024-07-03', false, NULL
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, suggested_category_id = NULL, parent_sale_id = NULL;

-- Test 2: uncategorized_count for 2024-07-02 counts rows A + B = 2
SELECT is(
  (SELECT uncategorized_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-02'::DATE
  )),
  2::BIGINT,
  'uncategorized_count counts is_categorized IS NOT TRUE AND suggested_category_id IS NULL (incl. legacy NULL)'
);

-- Test 3: pending_review_count for 2024-07-02 counts row C = 1
SELECT is(
  (SELECT pending_review_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-02'::DATE
  )),
  1::BIGINT,
  'pending_review_count counts is_categorized IS NOT TRUE AND suggested_category_id IS NOT NULL'
);

-- Test 4: child split (row E) excluded from both counts via parent_sale_id IS NULL
-- Total rows for the date for A,B,C,D = 4; total_count must equal 4 (not 5) — proves
-- the parent_sale_id filter applies to the categorization counts' base set too.
SELECT is(
  (SELECT total_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-02'::DATE
  )),
  4::BIGINT,
  'parent_sale_id IS NOT NULL rows (child splits) are excluded'
);

-- Test 5: widening date range to include 2024-07-03 picks up row F → uncategorized = 3
SELECT is(
  (SELECT uncategorized_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-03'::DATE
  )),
  3::BIGINT,
  'widening date range picks up row F (uncategorized) for 2024-07-03'
);

-- Test 6: pending_review_count unaffected by the wider window (no new pending row)
SELECT is(
  (SELECT pending_review_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-03'::DATE
  )),
  1::BIGINT,
  'pending_review_count unchanged by widening window when no new pending row'
);

-- Test 7: non-member call raises Access denied
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000002"}';
SELECT throws_ok(
  $$ SELECT * FROM get_unified_sales_totals('00000000-0000-0000-0000-000000000098'::uuid, '2024-07-02'::DATE, '2024-07-02'::DATE) $$,
  'Access denied to restaurant',
  'non-member call raises Access denied'
);

SELECT * FROM finish();
ROLLBACK;
