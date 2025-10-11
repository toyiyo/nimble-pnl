-- Tests for utility and maintenance functions
BEGIN;
SELECT plan(5);

-- REMOVED: cleanup_expired_invitations tests (function doesn't exist)

-- Test cleanup_old_audit_logs function exists (FIXED: no parameters, returns void)
SELECT has_function(
    'public',
    'cleanup_old_audit_logs',
    'cleanup_old_audit_logs function should exist'
);

SELECT function_returns(
    'public',
    'cleanup_old_audit_logs',
    'void',
    'cleanup_old_audit_logs should return void'
);

SELECT function_lang_is(
    'public',
    'cleanup_old_audit_logs',
    'plpgsql',
    'cleanup_old_audit_logs should be plpgsql'
);

-- REMOVED: cleanup_rate_limit_logs interval-based tests

-- Test cleanup_rate_limit_logs function exists (FIXED: no parameters, returns void)
SELECT has_function(
    'public',
    'cleanup_rate_limit_logs',
    'cleanup_rate_limit_logs function should exist'
);

SELECT function_returns(
    'public',
    'cleanup_rate_limit_logs',
    'void',
    'cleanup_rate_limit_logs should return void'
);

-- Test trigger_square_periodic_sync function exists
SELECT has_function(
    'public',
    'trigger_square_periodic_sync',
    'trigger_square_periodic_sync function should exist'
);

SELECT function_returns(
    'public',
    'trigger_square_periodic_sync',
    'void',
    'trigger_square_periodic_sync should return void'
);

SELECT * FROM finish();
ROLLBACK;
