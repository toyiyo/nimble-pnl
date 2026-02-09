-- Tests for get_pos_tips_by_date function
-- 
-- Tests tip aggregation from unified_sales_splits for tip pooling system

BEGIN;
SELECT plan(12);

-- Disable RLS for test setup
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales_splits DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- TEST SETUP: Create fixture data
-- ============================================================

-- Create test restaurant
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Test Restaurant', '123 Main St', '555-1234')
ON CONFLICT (id) DO UPDATE SET name = 'Test Restaurant';

-- Create test user access
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

-- Create test chart of accounts entries
INSERT INTO chart_of_accounts (id, restaurant_id, account_name, account_type, account_subtype) VALUES
  ('00000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Tips Revenue', 'revenue', 'sales'),
  ('00000000-0000-0000-0000-000000000011'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Other Income', 'revenue', 'other_income'),
  ('00000000-0000-0000-0000-000000000012'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'Food Sales', 'revenue', 'sales')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Create test unified_sales entries
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-001', 'Tip Item 1', 1, 50.00, '2024-01-15'),
  ('00000000-0000-0000-0000-000000000021'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-002', 'Tip Item 2', 1, 75.00, '2024-01-15'),
  ('00000000-0000-0000-0000-000000000022'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'toast', 'order-003', 'Tip Item 3', 1, 100.00, '2024-01-16'),
  ('00000000-0000-0000-0000-000000000023'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-004', 'Food Item', 1, 20.00, '2024-01-17')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Create test unified_sales_splits - categorize sales as tips
INSERT INTO unified_sales_splits (sale_id, category_id, amount) VALUES
  ('00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 50.00),      -- Matched by account_name 'Tips Revenue'
  ('00000000-0000-0000-0000-000000000021'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 75.00),      -- Matched by account_name 'Tips Revenue'
  ('00000000-0000-0000-0000-000000000022'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 100.00),     -- Matched by account_name 'Tips Revenue'
  ('00000000-0000-0000-0000-000000000023'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 20.00)        -- Not a tip
ON CONFLICT (sale_id, category_id) DO UPDATE SET amount = EXCLUDED.amount;

-- ============================================================
-- TEST 1: Function exists and has correct signature
-- ============================================================

SELECT has_function(
  'public',
  'get_pos_tips_by_date',
  ARRAY['uuid', 'date', 'date'],
  'get_pos_tips_by_date function should exist'
);

SELECT function_returns(
  'public',
  'get_pos_tips_by_date',
  ARRAY['uuid', 'date', 'date'],
  'table',
  'get_pos_tips_by_date should return table'
);

-- ============================================================
-- TEST 2: Filter by account name containing "tip"
-- ============================================================

SELECT ok(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-17'::DATE
  )) = 2,
  'Should return 2 date groups (2024-01-15 and 2024-01-16) when filtering by tip account name'
);

-- ============================================================
-- TEST 3: Correct cents conversion (amount * 100)
-- ============================================================

SELECT is(
  (SELECT total_amount_cents FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15' AND pos_source = 'square'),
  12500::INTEGER,
  'Should convert $125.00 (50 + 75) to 12500 cents for 2024-01-15'
);

-- ============================================================
-- TEST 4: Transaction count (DISTINCT external_order_id)
-- ============================================================

SELECT is(
  (SELECT transaction_count FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15' AND pos_source = 'square'),
  2::INTEGER,
  'Should count 2 distinct orders (order-001, order-002) for 2024-01-15'
);

-- ============================================================
-- TEST 5: Date range filtering
-- ============================================================

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-15'::DATE
  ))::INTEGER,
  1::INTEGER,
  'Should return only 1 row when filtering single date 2024-01-15'
);

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-16'::DATE,
    '2024-01-16'::DATE
  ))::INTEGER,
  1::INTEGER,
  'Should return only 1 row when filtering single date 2024-01-16'
);

-- ============================================================
-- TEST 6: Grouping by sale_date and pos_system
-- ============================================================

SELECT is(
  (SELECT pos_source FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15'),
  'square',
  'Should group by pos_system and return "square" for 2024-01-15'
);

SELECT is(
  (SELECT pos_source FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-16'::DATE,
    '2024-01-16'::DATE
  ) WHERE tip_date = '2024-01-16'),
  'toast',
  'Should group by pos_system and return "toast" for 2024-01-16'
);

-- ============================================================
-- TEST 7: Empty result when no tips in date range
-- ============================================================

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-20'::DATE,
    '2024-01-25'::DATE
  ))::INTEGER,
  0::INTEGER,
  'Should return 0 rows when no tips exist in date range'
);

-- ============================================================
-- TEST 8: Authorization check - should fail for non-member
-- ============================================================

-- Create a different user who doesn't have access to the test restaurant
SET LOCAL "request.jwt.claims" TO '{"sub": "99999999-9999-9999-9999-999999999999"}';

SELECT throws_ok(
  $$SELECT * FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-16'::DATE
  )$$,
  'Access denied: User does not have access to restaurant 00000000-0000-0000-0000-000000000001',
  'Should raise error when user does not have access to restaurant'
);

-- ============================================================
-- TEST 9: Ordering by sale_date DESC
-- ============================================================

-- Reset to test user
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

SELECT ok(
  (SELECT tip_date FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid,
    '2024-01-15'::DATE,
    '2024-01-16'::DATE
  ) LIMIT 1) = '2024-01-16'::DATE,
  'Should order results by sale_date DESC (most recent first)'
);

-- ============================================================
-- Cleanup
-- ============================================================

SELECT * FROM finish();
ROLLBACK;
