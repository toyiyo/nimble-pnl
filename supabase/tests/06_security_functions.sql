-- Tests for security and authentication functions
BEGIN;
SELECT plan(9);

-- Test create_restaurant_with_owner function exists
SELECT has_function(
    'public',
    'create_restaurant_with_owner',
    ARRAY['text', 'text', 'text', 'text', 'text'],
    'create_restaurant_with_owner function should exist'
);

SELECT function_returns(
    'public',
    'create_restaurant_with_owner',
    ARRAY['text', 'text', 'text', 'text', 'text'],
    'uuid',
    'create_restaurant_with_owner should return uuid'
);

SELECT function_lang_is(
    'public',
    'create_restaurant_with_owner',
    ARRAY['text', 'text', 'text', 'text', 'text'],
    'plpgsql',
    'create_restaurant_with_owner should be plpgsql'
);

-- Test hash_invitation_token function exists
SELECT has_function(
    'public',
    'hash_invitation_token',
    ARRAY['text'],
    'hash_invitation_token function should exist'
);

SELECT function_returns(
    'public',
    'hash_invitation_token',
    ARRAY['text'],
    'text',
    'hash_invitation_token should return text'
);

SELECT function_lang_is(
    'public',
    'hash_invitation_token',
    ARRAY['text'],
    'plpgsql',
    'hash_invitation_token should be plpgsql'
);

-- Test log_security_event function exists
SELECT has_function(
    'public',
    'log_security_event',
    ARRAY['text', 'uuid', 'jsonb', 'text'],
    'log_security_event function should exist'
);

SELECT function_returns(
    'public',
    'log_security_event',
    ARRAY['text', 'uuid', 'jsonb', 'text'],
    'void',
    'log_security_event should return void'
);

SELECT function_lang_is(
    'public',
    'log_security_event',
    ARRAY['text', 'uuid', 'jsonb', 'text'],
    'plpgsql',
    'log_security_event should be plpgsql'
);

SELECT * FROM finish();
ROLLBACK;
