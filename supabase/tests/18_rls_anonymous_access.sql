-- Tests for RLS anonymous access denial policies
-- Verifies that all sensitive tables have explicit policies denying anonymous access
-- Also verifies no risky USING (true) policies exist
BEGIN;
SELECT plan(43);

-- Helper function to check if a table has RLS enabled
CREATE OR REPLACE FUNCTION has_rls_enabled(schema_name text, table_name text)
RETURNS boolean AS $$
  SELECT relrowsecurity 
  FROM pg_class c 
  JOIN pg_namespace n ON c.relnamespace = n.oid 
  WHERE c.relname = table_name AND n.nspname = schema_name;
$$ LANGUAGE sql;

-- Helper function to check if anonymous denial policy exists
CREATE OR REPLACE FUNCTION has_anon_denial_policy(table_name text)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM pg_policies 
    WHERE schemaname = 'public' 
    AND tablename = table_name
    AND roles @> ARRAY['anon']
    AND cmd = 'ALL'
    AND qual = 'false'
  );
$$ LANGUAGE sql;

-- ============================================================================
-- TEST CATEGORY 1: Critical Security Tables - RLS Enabled
-- ============================================================================

-- Test 1-8: Verify RLS is enabled on all critical tables
SELECT ok(
  has_rls_enabled('public', 'employees'),
  'employees table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'profiles'),
  'profiles table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'customers'),
  'customers table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'bank_transactions'),
  'bank_transactions table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'employee_compensation_history'),
  'employee_compensation_history table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'time_punches'),
  'time_punches table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'purchase_orders'),
  'purchase_orders table should have RLS enabled'
);

SELECT ok(
  has_rls_enabled('public', 'square_connections'),
  'square_connections table should have RLS enabled'
);

-- ============================================================================
-- TEST CATEGORY 2: Critical Security Tables - Anonymous Denial Policies
-- ============================================================================

-- Test 9-16: Verify anonymous access is explicitly denied
SELECT ok(
  has_anon_denial_policy('employees'),
  'employees should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('profiles'),
  'profiles should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('customers'),
  'customers should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('bank_transactions'),
  'bank_transactions should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('employee_compensation_history'),
  'employee_compensation_history should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('time_punches'),
  'time_punches should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('purchase_orders'),
  'purchase_orders should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_connections'),
  'square_connections should have anonymous access denial policy'
);

-- ============================================================================
-- TEST CATEGORY 3: Related Sensitive Tables - Anonymous Denial
-- ============================================================================

-- Test 17-40: Verify related tables also have anonymous denial
SELECT ok(
  has_anon_denial_policy('shifts'),
  'shifts should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('shift_templates'),
  'shift_templates should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('time_off_requests'),
  'time_off_requests should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('employee_tips'),
  'employee_tips should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('connected_banks'),
  'connected_banks should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('bank_account_balances'),
  'bank_account_balances should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('bank_transaction_splits'),
  'bank_transaction_splits should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('transaction_categorization_rules'),
  'transaction_categorization_rules should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('chart_of_accounts'),
  'chart_of_accounts should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('journal_entries'),
  'journal_entries should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('journal_entry_lines'),
  'journal_entry_lines should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('financial_statement_cache'),
  'financial_statement_cache should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('stripe_connected_accounts'),
  'stripe_connected_accounts should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('invoices'),
  'invoices should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('invoice_line_items'),
  'invoice_line_items should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('invoice_payments'),
  'invoice_payments should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('purchase_order_lines'),
  'purchase_order_lines should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_locations'),
  'square_locations should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_catalog_objects'),
  'square_catalog_objects should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_orders'),
  'square_orders should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_order_line_items'),
  'square_order_line_items should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_payments'),
  'square_payments should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_refunds'),
  'square_refunds should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_team_members'),
  'square_team_members should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('square_shifts'),
  'square_shifts should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('unified_sales'),
  'unified_sales should have anonymous access denial policy'
);

SELECT ok(
  has_anon_denial_policy('unified_sales_splits'),
  'unified_sales_splits should have anonymous access denial policy'
);

-- ============================================================================
-- TEST CATEGORY 4: Verify No Risky USING (true) Policies
-- ============================================================================

-- Check that critical tables don't have USING (true) policies for authenticated users
SELECT is(
  (SELECT COUNT(*)::int
   FROM pg_policies
   WHERE schemaname = 'public'
   AND qual = 'true'
   AND roles @> ARRAY['authenticated']
   AND tablename IN (
     'employees', 'customers', 'bank_transactions', 'time_punches',
     'employee_compensation_history', 'purchase_orders', 'square_connections',
     'unified_sales', 'invoices', 'profiles'
   )
   AND policyname NOT LIKE '%service_role%'
   AND policyname NOT LIKE '%Service role%'
  ),
  0,
  'Critical tables should not have USING (true) policies for authenticated users'
);

-- Cleanup helper functions
DROP FUNCTION IF EXISTS has_rls_enabled(text, text);
DROP FUNCTION IF EXISTS has_anon_denial_policy(text);

SELECT * FROM finish();
ROLLBACK;
