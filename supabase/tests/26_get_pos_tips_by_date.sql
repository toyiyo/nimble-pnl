-- Tests for get_pos_tips_by_date function

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

-- Fixture data

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, 'tip-test@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'Test Restaurant', '123 Main St', '555-1234')
ON CONFLICT (id) DO UPDATE SET name = 'Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000000'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance) VALUES
  ('00000000-0000-0000-0000-000000000010'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'TIP001', 'Tips Revenue', 'revenue', 'sales', 'credit'),
  ('00000000-0000-0000-0000-000000000011'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'OTH001', 'Other Income', 'revenue', 'other_income', 'credit'),
  ('00000000-0000-0000-0000-000000000012'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'FOOD01', 'Food Sales', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date) VALUES
  ('00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-001', 'Tip Item 1', 1, 50.00, '2024-01-15'),
  ('00000000-0000-0000-0000-000000000021'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-002', 'Tip Item 2', 1, 75.00, '2024-01-15'),
  ('00000000-0000-0000-0000-000000000022'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'toast', 'order-003', 'Tip Item 3', 1, 100.00, '2024-01-16'),
  ('00000000-0000-0000-0000-000000000023'::uuid, '00000000-0000-0000-0000-000000000001'::uuid, 'square', 'order-004', 'Food Item', 1, 20.00, '2024-01-17')
ON CONFLICT (id) DO UPDATE SET total_price = EXCLUDED.total_price;

-- Splits: first three categorized as tips, last one as food (not a tip)
INSERT INTO unified_sales_splits (sale_id, category_id, amount) VALUES
  ('00000000-0000-0000-0000-000000000020'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 50.00),
  ('00000000-0000-0000-0000-000000000021'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 75.00),
  ('00000000-0000-0000-0000-000000000022'::uuid, '00000000-0000-0000-0000-000000000010'::uuid, 100.00),
  ('00000000-0000-0000-0000-000000000023'::uuid, '00000000-0000-0000-0000-000000000012'::uuid, 20.00);

-- Test 1: Function exists with correct signature

SELECT has_function(
  'public', 'get_pos_tips_by_date', ARRAY['uuid', 'date', 'date'],
  'get_pos_tips_by_date function should exist'
);

SELECT function_returns(
  'public', 'get_pos_tips_by_date', ARRAY['uuid', 'date', 'date'], 'setof record',
  'get_pos_tips_by_date should return setof record'
);

-- Test 2: Filters by account name containing "tip"

SELECT ok(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-17'::DATE
  )) = 2,
  'Should return 2 date groups (Jan 15 square, Jan 16 toast) excluding non-tip entries'
);

-- Test 3: Correct cents conversion (amount * 100)

SELECT is(
  (SELECT total_amount_cents FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15' AND pos_source = 'square'),
  12500::INTEGER,
  'Should convert $125.00 (50 + 75) to 12500 cents'
);

-- Test 4: Transaction count uses DISTINCT external_order_id

SELECT is(
  (SELECT transaction_count FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15' AND pos_source = 'square'),
  2::INTEGER,
  'Should count 2 distinct orders for Jan 15'
);

-- Test 5: Date range filtering

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-15'::DATE
  ))::INTEGER,
  1::INTEGER,
  'Single date range should return 1 row'
);

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-16'::DATE, '2024-01-16'::DATE
  ))::INTEGER,
  1::INTEGER,
  'Single date range for Jan 16 should return 1 row'
);

-- Test 6: Groups by pos_system

SELECT is(
  (SELECT pos_source FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-15'::DATE
  ) WHERE tip_date = '2024-01-15'),
  'square',
  'Jan 15 tips should be grouped under square'
);

SELECT is(
  (SELECT pos_source FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-16'::DATE, '2024-01-16'::DATE
  ) WHERE tip_date = '2024-01-16'),
  'toast',
  'Jan 16 tips should be grouped under toast'
);

-- Test 7: Empty result for date range with no tips

SELECT is(
  (SELECT COUNT(*) FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-20'::DATE, '2024-01-25'::DATE
  ))::INTEGER,
  0::INTEGER,
  'Should return 0 rows for date range with no tips'
);

-- Test 8: Authorization check rejects non-member

SET LOCAL "request.jwt.claims" TO '{"sub": "99999999-9999-9999-9999-999999999999"}';

SELECT throws_ok(
  $$SELECT * FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-16'::DATE
  )$$,
  'Access denied: User does not have access to restaurant 00000000-0000-0000-0000-000000000001',
  'Should raise error for unauthorized user'
);

-- Test 9: Results ordered by sale_date DESC

SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

SELECT ok(
  (SELECT tip_date FROM get_pos_tips_by_date(
    '00000000-0000-0000-0000-000000000001'::uuid, '2024-01-15'::DATE, '2024-01-16'::DATE
  ) LIMIT 1) = '2024-01-16'::DATE,
  'First row should be most recent date (DESC order)'
);

SELECT * FROM finish();
ROLLBACK;
