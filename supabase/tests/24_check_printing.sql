-- Tests for check printing tables and functions
BEGIN;
SELECT plan(24);

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

-- ==========================================
-- Behavioral tests: claim_check_numbers validation
-- ==========================================

-- Input validation fires before the auth check, so these work without auth context.

SELECT throws_ok(
    $$SELECT claim_check_numbers('00000000-0000-0000-0000-000000000001'::uuid, 0)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers rejects p_count = 0'
);

SELECT throws_ok(
    $$SELECT claim_check_numbers('00000000-0000-0000-0000-000000000001'::uuid, -1)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers rejects p_count = -1'
);

SELECT throws_ok(
    $$SELECT claim_check_numbers('00000000-0000-0000-0000-000000000001'::uuid, 101)$$,
    'Check count must be between 1 and 100',
    'claim_check_numbers rejects p_count = 101'
);

-- ==========================================
-- Behavioral tests: check_audit_log action CHECK constraint
-- ==========================================

-- Temporarily disable RLS to test the CHECK constraint directly
ALTER TABLE public.check_audit_log DISABLE ROW LEVEL SECURITY;

-- We need a real restaurant for the FK. Use an existing one or create a temp one.
-- Insert with ON CONFLICT to be idempotent.
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
