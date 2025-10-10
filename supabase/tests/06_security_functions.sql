-- Tests for security and authentication functions
BEGIN;
SELECT plan(15);

-- Test handle_new_user function exists
SELECT has_function(
    'public',
    'handle_new_user',
    'handle_new_user function should exist'
);

SELECT function_returns(
    'public',
    'handle_new_user',
    'trigger',
    'handle_new_user should return trigger'
);

SELECT function_lang_is(
    'public',
    'handle_new_user',
    'plpgsql',
    'handle_new_user should be plpgsql'
);

-- Test create_restaurant_with_owner function exists
SELECT has_function(
    'public',
    'create_restaurant_with_owner',
    ARRAY['uuid', 'text'],
    'create_restaurant_with_owner function should exist'
);

SELECT function_returns(
    'public',
    'create_restaurant_with_owner',
    ARRAY['uuid', 'text'],
    'uuid',
    'create_restaurant_with_owner should return uuid'
);

SELECT function_lang_is(
    'public',
    'create_restaurant_with_owner',
    ARRAY['uuid', 'text'],
    'plpgsql',
    'create_restaurant_with_owner should be plpgsql'
);

-- Test is_restaurant_owner function exists
SELECT has_function(
    'public',
    'is_restaurant_owner',
    ARRAY['uuid', 'uuid'],
    'is_restaurant_owner function should exist'
);

SELECT function_returns(
    'public',
    'is_restaurant_owner',
    ARRAY['uuid', 'uuid'],
    'boolean',
    'is_restaurant_owner should return boolean'
);

SELECT function_lang_is(
    'public',
    'is_restaurant_owner',
    ARRAY['uuid', 'uuid'],
    'plpgsql',
    'is_restaurant_owner should be plpgsql'
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
    ARRAY['uuid', 'text', 'text', 'jsonb'],
    'log_security_event function should exist'
);

SELECT function_returns(
    'public',
    'log_security_event',
    ARRAY['uuid', 'text', 'text', 'jsonb'],
    'void',
    'log_security_event should return void'
);

SELECT function_lang_is(
    'public',
    'log_security_event',
    ARRAY['uuid', 'text', 'text', 'jsonb'],
    'plpgsql',
    'log_security_event should be plpgsql'
);

SELECT * FROM finish();
ROLLBACK;
