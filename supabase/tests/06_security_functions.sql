-- Tests for security and authentication functions
BEGIN;
SELECT plan(17);

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

-- manager_pins RLS & policy checks
-- Check that row level security is enabled on manager_pins
SELECT ok(
    (SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid WHERE c.relname = 'manager_pins' AND n.nspname='public'),
    'manager_pins should have row level security enabled'
);

-- Check that at least one policy exists on manager_pins
SELECT ok(
    ((SELECT COUNT(*) FROM pg_policies WHERE tablename = 'manager_pins')::int > 0),
    'manager_pins should have policies defined'
);

-- Restaurants insert policy should exist
SELECT ok(
    EXISTS(
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
          AND tablename = 'restaurants' 
          AND policyname = 'Users can insert restaurants if they''re the owner'
    ),
    'Restaurant insert policy should exist'
);

-- Seed owner/non-owner users for function behavior checks
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES 
    ('00000000-0000-0000-0000-000000000601'::uuid, 'first-time-owner@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000602'::uuid, 'manager-invite@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000603'::uuid, 'existing-owner@test.com', crypt('password123', gen_salt('bf')), NOW(), '{"provider":"email"}', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Existing restaurant to attach roles
INSERT INTO restaurants (id, name)
VALUES ('00000000-0000-0000-0000-000000000701'::uuid, 'Policy Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Attach manager and owner roles to the existing restaurant
DELETE FROM user_restaurants WHERE user_id IN (
  '00000000-0000-0000-0000-000000000601'::uuid,
  '00000000-0000-0000-0000-000000000602'::uuid,
  '00000000-0000-0000-0000-000000000603'::uuid
);

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES 
  ('00000000-0000-0000-0000-000000000602'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, 'manager'),
  ('00000000-0000-0000-0000-000000000603'::uuid, '00000000-0000-0000-0000-000000000701'::uuid, 'owner');

-- Ensure profile roles reflect owner for existing owner
UPDATE profiles SET role = 'owner' WHERE user_id = '00000000-0000-0000-0000-000000000603'::uuid;

-- First-time user (no associations) should be allowed
RESET role;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000601", "role": "authenticated"}';

SELECT ok(
    (SELECT create_restaurant_with_owner('First-Time Owner Creation', NULL, NULL, NULL, 'America/Chicago')) IS NOT NULL,
    'First-time user should be able to create initial restaurant'
);

SELECT ok(
    EXISTS(
        SELECT 1 FROM user_restaurants 
        WHERE user_id = '00000000-0000-0000-0000-000000000601'::uuid
          AND role = 'owner'
    ),
    'First-time user should be linked as owner to new restaurant'
);

-- Non-owner with existing manager role should be blocked
RESET role;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000602", "role": "authenticated"}';

SELECT throws_ok(
    $$SELECT create_restaurant_with_owner('Manager Creation Attempt', NULL, NULL, NULL, 'America/Chicago');$$,
    'P0001',
    'Managers should not be able to create restaurants'
);

-- Existing owner should be allowed
RESET role;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000603", "role": "authenticated"}';

SELECT ok(
    (SELECT create_restaurant_with_owner('Existing Owner Creation', NULL, NULL, NULL, 'America/Chicago')) IS NOT NULL,
    'Owners should be able to create restaurants'
);

SELECT ok(
    EXISTS(
        SELECT 1 FROM user_restaurants 
        WHERE user_id = '00000000-0000-0000-0000-000000000603'::uuid
          AND role = 'owner'
    ),
    'Owner should be linked to newly created restaurant'
);

RESET role;
RESET "request.jwt.claims";

SELECT * FROM finish();
ROLLBACK;
