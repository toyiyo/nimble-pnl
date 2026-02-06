-- Tests for check printing tables and functions
BEGIN;
SELECT plan(16);

-- ==========================================
-- Test check_settings table
-- ==========================================

SELECT has_table('public', 'check_settings', 'check_settings table should exist');

SELECT has_column('public', 'check_settings', 'restaurant_id', 'check_settings should have restaurant_id');
SELECT has_column('public', 'check_settings', 'business_name', 'check_settings should have business_name');
SELECT has_column('public', 'check_settings', 'next_check_number', 'check_settings should have next_check_number');

SELECT col_default_is(
    'public', 'check_settings', 'next_check_number', '1001',
    'next_check_number default should be 1001'
);

-- ==========================================
-- Test check_audit_log table
-- ==========================================

SELECT has_table('public', 'check_audit_log', 'check_audit_log table should exist');

SELECT has_column('public', 'check_audit_log', 'check_number', 'check_audit_log should have check_number');
SELECT has_column('public', 'check_audit_log', 'payee_name', 'check_audit_log should have payee_name');
SELECT has_column('public', 'check_audit_log', 'amount', 'check_audit_log should have amount');
SELECT has_column('public', 'check_audit_log', 'action', 'check_audit_log should have action');
SELECT has_column('public', 'check_audit_log', 'performed_by', 'check_audit_log should have performed_by');
SELECT has_column('public', 'check_audit_log', 'void_reason', 'check_audit_log should have void_reason');

-- ==========================================
-- Test claim_check_numbers function
-- ==========================================

SELECT has_function(
    'public',
    'claim_check_numbers',
    ARRAY['uuid', 'integer'],
    'claim_check_numbers function should exist'
);

SELECT function_returns(
    'public',
    'claim_check_numbers',
    ARRAY['uuid', 'integer'],
    'integer',
    'claim_check_numbers should return integer'
);

SELECT function_lang_is(
    'public',
    'claim_check_numbers',
    ARRAY['uuid', 'integer'],
    'plpgsql',
    'claim_check_numbers should be plpgsql'
);

-- Test that the function is SECURITY DEFINER
SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'claim_check_numbers'),
    true,
    'claim_check_numbers should be SECURITY DEFINER'
);

SELECT * FROM finish();
ROLLBACK;
