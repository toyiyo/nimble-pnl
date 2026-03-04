-- Tests for check printing tables and functions (multi-bank-account schema)
BEGIN;
SELECT plan(33);

-- ==========================================
-- 1. check_bank_accounts table structure
-- ==========================================

SELECT has_table('public', 'check_bank_accounts', 'check_bank_accounts table should exist');

SELECT has_column('public', 'check_bank_accounts', 'restaurant_id',
    'check_bank_accounts should have restaurant_id');
SELECT has_column('public', 'check_bank_accounts', 'account_name',
    'check_bank_accounts should have account_name');
SELECT has_column('public', 'check_bank_accounts', 'bank_name',
    'check_bank_accounts should have bank_name');
SELECT has_column('public', 'check_bank_accounts', 'connected_bank_id',
    'check_bank_accounts should have connected_bank_id');
SELECT has_column('public', 'check_bank_accounts', 'next_check_number',
    'check_bank_accounts should have next_check_number');
SELECT has_column('public', 'check_bank_accounts', 'is_default',
    'check_bank_accounts should have is_default');
SELECT has_column('public', 'check_bank_accounts', 'is_active',
    'check_bank_accounts should have is_active');

-- 2. next_check_number default is 1001
SELECT col_default_is(
    'public', 'check_bank_accounts', 'next_check_number', '1001',
    'next_check_number default should be 1001'
);

-- ==========================================
-- 3. check_audit_log table structure
-- ==========================================

SELECT has_table('public', 'check_audit_log', 'check_audit_log table should exist');

SELECT has_column('public', 'check_audit_log', 'check_number',
    'check_audit_log should have check_number');
SELECT has_column('public', 'check_audit_log', 'payee_name',
    'check_audit_log should have payee_name');
SELECT has_column('public', 'check_audit_log', 'amount',
    'check_audit_log should have amount');
SELECT has_column('public', 'check_audit_log', 'action',
    'check_audit_log should have action');
SELECT has_column('public', 'check_audit_log', 'performed_by',
    'check_audit_log should have performed_by');
SELECT has_column('public', 'check_audit_log', 'void_reason',
    'check_audit_log should have void_reason');
SELECT has_column('public', 'check_audit_log', 'check_bank_account_id',
    'check_audit_log should have check_bank_account_id');

-- ==========================================
-- 4. pending_outflows has new column
-- ==========================================

SELECT has_column('public', 'pending_outflows', 'check_bank_account_id',
    'pending_outflows should have check_bank_account_id');

-- ==========================================
-- 5. check_settings no longer has migrated columns
-- ==========================================

SELECT has_table('public', 'check_settings', 'check_settings table should still exist');

SELECT hasnt_column('public', 'check_settings', 'bank_name',
    'check_settings should NOT have bank_name (migrated to check_bank_accounts)');
SELECT hasnt_column('public', 'check_settings', 'next_check_number',
    'check_settings should NOT have next_check_number (migrated to check_bank_accounts)');

-- ==========================================
-- 6. claim_check_numbers_for_account function
-- ==========================================

SELECT has_function(
    'public',
    'claim_check_numbers_for_account',
    ARRAY['uuid', 'integer'],
    'claim_check_numbers_for_account function should exist'
);

SELECT function_returns(
    'public',
    'claim_check_numbers_for_account',
    ARRAY['uuid', 'integer'],
    'integer',
    'claim_check_numbers_for_account should return integer'
);

SELECT function_lang_is(
    'public',
    'claim_check_numbers_for_account',
    ARRAY['uuid', 'integer'],
    'plpgsql',
    'claim_check_numbers_for_account should be plpgsql'
);

-- Test that the function is SECURITY DEFINER
SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'claim_check_numbers_for_account'),
    true,
    'claim_check_numbers_for_account should be SECURITY DEFINER'
);

-- ==========================================
-- 7. Input validation: p_count boundaries
-- ==========================================

-- Input validation fires before the account lookup, so these work without auth context.

SELECT throws_ok(
    $$SELECT claim_check_numbers_for_account('00000000-0000-0000-0000-000000000001'::uuid, 0)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers_for_account rejects p_count = 0'
);

SELECT throws_ok(
    $$SELECT claim_check_numbers_for_account('00000000-0000-0000-0000-000000000001'::uuid, -1)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers_for_account rejects p_count = -1'
);

SELECT throws_ok(
    $$SELECT claim_check_numbers_for_account('00000000-0000-0000-0000-000000000001'::uuid, 101)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers_for_account rejects p_count = 101'
);

-- ==========================================
-- 8. Account not found
-- ==========================================

SELECT throws_ok(
    $$SELECT claim_check_numbers_for_account('00000000-0000-0000-0000-aaaaaaaaaaaa'::uuid, 1)$$,
    'Check bank account not found: 00000000-0000-0000-0000-aaaaaaaaaaaa',
    'claim_check_numbers_for_account rejects unknown account_id'
);

-- ==========================================
-- 9. check_audit_log action CHECK constraint
-- ==========================================

-- Temporarily disable RLS to test the CHECK constraint directly
ALTER TABLE public.check_audit_log DISABLE ROW LEVEL SECURITY;

-- We need a real restaurant for the FK.
INSERT INTO public.restaurants (id, name)
VALUES ('00000000-0000-0000-0000-ffffffffffff'::uuid, 'pgTAP Test Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Valid action values should succeed
SELECT lives_ok(
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('00000000-0000-0000-0000-ffffffffffff'::uuid, 9999, 'Test Payee', 100.00, CURRENT_DATE, 'printed')$$,
    'check_audit_log accepts action = printed'
);

SELECT lives_ok(
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('00000000-0000-0000-0000-ffffffffffff'::uuid, 9999, 'Test Payee', 100.00, CURRENT_DATE, 'voided')$$,
    'check_audit_log accepts action = voided'
);

SELECT lives_ok(
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('00000000-0000-0000-0000-ffffffffffff'::uuid, 9999, 'Test Payee', 100.00, CURRENT_DATE, 'reprinted')$$,
    'check_audit_log accepts action = reprinted'
);

-- Invalid action value should fail CHECK constraint
SELECT throws_ok(
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('00000000-0000-0000-0000-ffffffffffff'::uuid, 9999, 'Test Payee', 100.00, CURRENT_DATE, 'deleted')$$,
    '23514',
    NULL,
    'check_audit_log rejects invalid action value'
);

-- Re-enable RLS
ALTER TABLE public.check_audit_log ENABLE ROW LEVEL SECURITY;

SELECT * FROM finish();
ROLLBACK;
