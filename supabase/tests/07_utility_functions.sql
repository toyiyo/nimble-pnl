-- Tests for utility and maintenance functions
BEGIN;
SELECT plan(12);

-- Test cleanup_expired_invitations function exists
SELECT has_function(
    'public',
    'cleanup_expired_invitations',
    'cleanup_expired_invitations function should exist'
);

SELECT function_returns(
    'public',
    'cleanup_expired_invitations',
    'integer',
    'cleanup_expired_invitations should return integer'
);

SELECT function_lang_is(
    'public',
    'cleanup_expired_invitations',
    'plpgsql',
    'cleanup_expired_invitations should be plpgsql'
);

SELECT volatility_is(
    'public',
    'cleanup_expired_invitations',
    'volatile',
    'cleanup_expired_invitations should be volatile'
);

-- Test cleanup_old_audit_logs function exists
SELECT has_function(
    'public',
    'cleanup_old_audit_logs',
    ARRAY['interval'],
    'cleanup_old_audit_logs function should exist'
);

SELECT function_returns(
    'public',
    'cleanup_old_audit_logs',
    ARRAY['interval'],
    'integer',
    'cleanup_old_audit_logs should return integer'
);

SELECT function_lang_is(
    'public',
    'cleanup_old_audit_logs',
    ARRAY['interval'],
    'plpgsql',
    'cleanup_old_audit_logs should be plpgsql'
);

-- Test cleanup_rate_limit_logs function exists
SELECT has_function(
    'public',
    'cleanup_rate_limit_logs',
    ARRAY['interval'],
    'cleanup_rate_limit_logs function should exist'
);

SELECT function_returns(
    'public',
    'cleanup_rate_limit_logs',
    ARRAY['interval'],
    'integer',
    'cleanup_rate_limit_logs should return integer'
);

SELECT function_lang_is(
    'public',
    'cleanup_rate_limit_logs',
    ARRAY['interval'],
    'plpgsql',
    'cleanup_rate_limit_logs should be plpgsql'
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
