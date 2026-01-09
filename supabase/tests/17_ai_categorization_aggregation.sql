-- Tests for AI categorization aggregation functions
-- Tests get_uncovered_pos_patterns and get_uncovered_bank_patterns

BEGIN;
SELECT plan(14);

-- Setup: Disable RLS and create test data
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000000"}';

-- Disable RLS for test tables
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE connected_banks DISABLE ROW LEVEL SECURITY;
ALTER TABLE categorization_rules DISABLE ROW LEVEL SECURITY;

-- Create test restaurant
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000ACC', 'Test Restaurant AI Cat')
ON CONFLICT (id) DO NOTHING;

-- Create test chart of accounts
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, is_active) VALUES
  ('test-coa-1', '00000000-0000-0000-0000-000000000ACC', '4000', 'Food Sales', 'revenue', true),
  ('test-coa-2', '00000000-0000-0000-0000-000000000ACC', '4010', 'Beverage Sales', 'revenue', true),
  ('test-coa-3', '00000000-0000-0000-0000-000000000ACC', '5000', 'Food Costs', 'expense', true),
  ('test-coa-4', '00000000-0000-0000-0000-000000000ACC', '2200', 'Sales Tax Payable', 'liability', true)
ON CONFLICT (id) DO UPDATE SET 
  account_code = EXCLUDED.account_code,
  account_name = EXCLUDED.account_name;

-- ============================================================
-- TEST CATEGORY 1: POS Pattern Aggregation
-- ============================================================

-- Create test POS sales data with patterns
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date, pos_category, category_id, is_categorized) VALUES
  -- Pattern 1: Sales Tax (high frequency - 5 occurrences)
  ('pos-1-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-1', 'Sales Tax', 1, 0.60, CURRENT_DATE - INTERVAL '1 month', 'Tax', 'test-coa-4', true),
  ('pos-1-2', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-2', 'Sales Tax', 1, 0.60, CURRENT_DATE - INTERVAL '2 months', 'Tax', 'test-coa-4', true),
  ('pos-1-3', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-3', 'Sales Tax', 1, 0.60, CURRENT_DATE - INTERVAL '3 months', 'Tax', 'test-coa-4', true),
  ('pos-1-4', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-4', 'Sales Tax', 1, 0.60, CURRENT_DATE - INTERVAL '4 months', 'Tax', 'test-coa-4', true),
  ('pos-1-5', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-5', 'Sales Tax', 1, 0.60, CURRENT_DATE - INTERVAL '5 months', 'Tax', 'test-coa-4', true),
  -- Pattern 2: Burger (medium frequency - 3 occurrences)
  ('pos-2-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-6', 'Burger', 1, 12.99, CURRENT_DATE - INTERVAL '1 week', 'Food', 'test-coa-1', true),
  ('pos-2-2', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-7', 'Burger', 1, 12.99, CURRENT_DATE - INTERVAL '2 weeks', 'Food', 'test-coa-1', true),
  ('pos-2-3', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-8', 'Burger', 1, 12.99, CURRENT_DATE - INTERVAL '3 weeks', 'Food', 'test-coa-1', true),
  -- Pattern 3: Soda (low frequency - 2 occurrences)
  ('pos-3-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-9', 'Soda', 1, 2.50, CURRENT_DATE - INTERVAL '1 day', 'Beverage', 'test-coa-2', true),
  ('pos-3-2', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-10', 'Soda', 1, 2.50, CURRENT_DATE - INTERVAL '2 days', 'Beverage', 'test-coa-2', true),
  -- Pattern 4: Pizza (single occurrence - should still appear)
  ('pos-4-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-11', 'Pizza', 1, 18.99, CURRENT_DATE - INTERVAL '1 hour', 'Food', 'test-coa-1', true),
  -- Uncategorized sale (should be excluded)
  ('pos-5-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-12', 'Unknown Item', 1, 5.00, CURRENT_DATE, 'Food', NULL, false),
  -- Old sale beyond 12 months (should be excluded)
  ('pos-6-1', '00000000-0000-0000-0000-000000000ACC', 'square', 'order-13', 'Old Item', 1, 10.00, CURRENT_DATE - INTERVAL '13 months', 'Food', 'test-coa-1', true)
ON CONFLICT (id) DO UPDATE SET
  item_name = EXCLUDED.item_name,
  category_id = EXCLUDED.category_id,
  is_categorized = EXCLUDED.is_categorized,
  sale_date = EXCLUDED.sale_date;

-- Test 1: Function returns correct number of patterns
SELECT ok(
  (SELECT COUNT(*) FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200)) = 4,
  'get_uncovered_pos_patterns: Should return 4 unique patterns (excludes uncategorized and old data)'
);

-- Test 2: Results are ordered by occurrence count (highest first)
SELECT is(
  (SELECT item_name FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) LIMIT 1),
  'Sales Tax',
  'get_uncovered_pos_patterns: Should order by occurrence count DESC (Sales Tax has 5 occurrences)'
);

-- Test 3: Occurrence count is correct for top pattern
SELECT is(
  (SELECT occurrence_count FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE item_name = 'Sales Tax'),
  5::bigint,
  'get_uncovered_pos_patterns: Sales Tax should have 5 occurrences'
);

-- Test 4: Typical price is correctly rounded
SELECT is(
  (SELECT typical_price FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE item_name = 'Burger'),
  12.99::numeric,
  'get_uncovered_pos_patterns: Should round price to 2 decimals'
);

-- Test 5: Category information is included
SELECT ok(
  (SELECT category_code FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE item_name = 'Sales Tax') = '2200',
  'get_uncovered_pos_patterns: Should include category_code'
);

-- Test 6: Date range is included
SELECT ok(
  (SELECT date_range FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE item_name = 'Burger') LIKE '%to%',
  'get_uncovered_pos_patterns: Should include date_range in format "date to date"'
);

-- ============================================================
-- TEST CATEGORY 2: Rule Exclusion for POS
-- ============================================================

-- Create a categorization rule that matches "Sales Tax"
INSERT INTO categorization_rules (id, restaurant_id, rule_name, applies_to, item_name_pattern, item_name_match_type, category_id, priority, is_active) VALUES
  ('rule-pos-1', '00000000-0000-0000-0000-000000000ACC', 'Sales Tax Rule', 'pos_sales', 'Sales Tax', 'exact', 'test-coa-4', 10, true)
ON CONFLICT (id) DO UPDATE SET
  item_name_pattern = EXCLUDED.item_name_pattern,
  is_active = EXCLUDED.is_active;

-- Test 7: Existing rules are excluded from results
SELECT ok(
  (SELECT COUNT(*) FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200)) = 3,
  'get_uncovered_pos_patterns: Should exclude items matching active rules (3 patterns remaining after excluding Sales Tax)'
);

-- Test 8: Sales Tax should not appear in results after rule creation
SELECT ok(
  NOT EXISTS (SELECT 1 FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE item_name = 'Sales Tax'),
  'get_uncovered_pos_patterns: Should not return Sales Tax when matching rule exists'
);

-- Deactivate the rule
UPDATE categorization_rules SET is_active = false WHERE id = 'rule-pos-1';

-- Test 9: Inactive rules should not exclude patterns
SELECT ok(
  (SELECT COUNT(*) FROM get_uncovered_pos_patterns('00000000-0000-0000-0000-000000000ACC', 200)) = 4,
  'get_uncovered_pos_patterns: Inactive rules should not exclude patterns (Sales Tax should reappear)'
);

-- ============================================================
-- TEST CATEGORY 3: Bank Transaction Pattern Aggregation
-- ============================================================

-- Create test connected bank
INSERT INTO connected_banks (id, restaurant_id, bank_name, account_name, status) VALUES
  ('test-bank-1', '00000000-0000-0000-0000-000000000ACC', 'Test Bank', 'Business Checking', 'active')
ON CONFLICT (id) DO NOTHING;

-- Create test bank transactions with patterns
INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, description, merchant_name, normalized_payee, amount, category_id, is_categorized) VALUES
  -- Pattern 1: Sysco deliveries (high frequency - 4 occurrences)
  ('bank-1-1', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-1', CURRENT_DATE - INTERVAL '1 week', 'SYSCO FOOD SERVICES', 'Sysco', 'Sysco', -500.00, 'test-coa-3', true),
  ('bank-1-2', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-2', CURRENT_DATE - INTERVAL '2 weeks', 'SYSCO FOOD SERVICES', 'Sysco', 'Sysco', -525.00, 'test-coa-3', true),
  ('bank-1-3', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-3', CURRENT_DATE - INTERVAL '3 weeks', 'SYSCO FOOD SERVICES', 'Sysco', 'Sysco', -490.00, 'test-coa-3', true),
  ('bank-1-4', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-4', CURRENT_DATE - INTERVAL '4 weeks', 'SYSCO FOOD SERVICES', 'Sysco', 'Sysco', -510.00, 'test-coa-3', true),
  -- Pattern 2: Utility bill (medium frequency - 2 occurrences)
  ('bank-2-1', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-5', CURRENT_DATE - INTERVAL '1 month', 'PG&E PAYMENT', 'PG&E', 'PG&E', -150.00, 'test-coa-3', true),
  ('bank-2-2', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-6', CURRENT_DATE - INTERVAL '2 months', 'PG&E PAYMENT', 'PG&E', 'PG&E', -155.00, 'test-coa-3', true),
  -- Uncategorized transaction (should be excluded)
  ('bank-3-1', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-7', CURRENT_DATE, 'UNKNOWN VENDOR', 'Unknown', 'Unknown', -100.00, NULL, false),
  -- Old transaction beyond 12 months (should be excluded)
  ('bank-4-1', '00000000-0000-0000-0000-000000000ACC', 'test-bank-1', 'txn-8', CURRENT_DATE - INTERVAL '13 months', 'OLD VENDOR', 'Old Vendor', 'Old Vendor', -200.00, 'test-coa-3', true)
ON CONFLICT (id) DO UPDATE SET
  description = EXCLUDED.description,
  category_id = EXCLUDED.category_id,
  is_categorized = EXCLUDED.is_categorized,
  transaction_date = EXCLUDED.transaction_date;

-- Test 10: Function returns correct number of bank patterns
SELECT ok(
  (SELECT COUNT(*) FROM get_uncovered_bank_patterns('00000000-0000-0000-0000-000000000ACC', 200)) = 2,
  'get_uncovered_bank_patterns: Should return 2 unique patterns (excludes uncategorized and old data)'
);

-- Test 11: Bank results are ordered by occurrence count
SELECT is(
  (SELECT description FROM get_uncovered_bank_patterns('00000000-0000-0000-0000-000000000ACC', 200) LIMIT 1),
  'SYSCO FOOD SERVICES',
  'get_uncovered_bank_patterns: Should order by occurrence count DESC (Sysco has 4 occurrences)'
);

-- Test 12: Occurrence count is correct for bank pattern
SELECT is(
  (SELECT occurrence_count FROM get_uncovered_bank_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE description = 'SYSCO FOOD SERVICES'),
  4::bigint,
  'get_uncovered_bank_patterns: Sysco should have 4 occurrences'
);

-- Test 13: Amount range is included for bank patterns
SELECT ok(
  (SELECT amount_range FROM get_uncovered_bank_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE description = 'SYSCO FOOD SERVICES') LIKE '$%-%$%',
  'get_uncovered_bank_patterns: Should include amount_range in format "$min - $max"'
);

-- Test 14: Typical amount is averaged
SELECT ok(
  (SELECT typical_amount FROM get_uncovered_bank_patterns('00000000-0000-0000-0000-000000000ACC', 200) WHERE description = 'SYSCO FOOD SERVICES') BETWEEN 500.00 AND 510.00,
  'get_uncovered_bank_patterns: Should calculate average typical_amount (should be ~506.25 for Sysco)'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
