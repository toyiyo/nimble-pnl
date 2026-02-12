-- Test permission checks for apply_rules functions
-- Tests that the functions properly validate user permissions before applying rules

BEGIN;
SELECT plan(6);

-- Setup: Create test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000001"}';

-- Create test restaurant
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000099', 'Test Restaurant 1')
ON CONFLICT (id) DO NOTHING;

-- Create test user
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000001', 'test@example.com')
ON CONFLICT (id) DO NOTHING;

-- Create test chart of accounts (including cash account required by apply_rules_to_bank_transactions)
INSERT INTO chart_of_accounts (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance) VALUES
  ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000099', 'Test Account', '5000', 'expense', 'cost_of_goods_sold', 'debit'),
  ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000099', 'Cash', '1000', 'asset', 'cash', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- ============================================================
-- TEST 1: Owner should be able to apply rules to POS sales
-- ============================================================

-- Create owner relationship
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_pos_sales('00000000-0000-0000-0000-000000000099', 100)$$,
  'Owner should be able to apply rules to POS sales'
);

-- ============================================================
-- TEST 2: Manager should be able to apply rules to POS sales
-- ============================================================

-- Change to manager role
UPDATE user_restaurants
SET role = 'manager'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_pos_sales('00000000-0000-0000-0000-000000000099', 100)$$,
  'Manager should be able to apply rules to POS sales'
);

-- ============================================================
-- TEST 3: Staff should NOT be able to apply rules to POS sales
-- ============================================================

-- Change to staff role
UPDATE user_restaurants
SET role = 'staff'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales('00000000-0000-0000-0000-000000000099', 100)$$,
  'Permission denied: user does not have access to apply rules for this restaurant',
  'Staff should NOT be able to apply rules to POS sales'
);

-- ============================================================
-- TEST 4: Owner should be able to apply rules to bank transactions
-- ============================================================

-- Reset to owner role
UPDATE user_restaurants
SET role = 'owner'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_bank_transactions('00000000-0000-0000-0000-000000000099', 100)$$,
  'Owner should be able to apply rules to bank transactions'
);

-- ============================================================
-- TEST 5: Manager should be able to apply rules to bank transactions
-- ============================================================

-- Change to manager role
UPDATE user_restaurants
SET role = 'manager'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_bank_transactions('00000000-0000-0000-0000-000000000099', 100)$$,
  'Manager should be able to apply rules to bank transactions'
);

-- ============================================================
-- TEST 6: Chef should NOT be able to apply rules to bank transactions
-- ============================================================

-- Change to chef role
UPDATE user_restaurants
SET role = 'chef'
WHERE user_id = '00000000-0000-0000-0000-000000000001'
  AND restaurant_id = '00000000-0000-0000-0000-000000000099';

SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_bank_transactions('00000000-0000-0000-0000-000000000099', 100)$$,
  'Permission denied: user does not have access to apply rules for this restaurant',
  'Chef should NOT be able to apply rules to bank transactions'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
