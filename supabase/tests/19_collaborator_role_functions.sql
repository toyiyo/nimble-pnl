-- ============================================================================
-- Tests for Collaborator Role Functions
--
-- Tests the SQL functions introduced for role-based permission checking:
-- - user_has_role(p_restaurant_id, p_roles[])
-- - user_is_internal_team(p_restaurant_id)
-- - user_is_collaborator(p_restaurant_id)
-- - user_has_capability(p_restaurant_id, p_capability)
-- ============================================================================

BEGIN;
SELECT plan(32);

-- ============================================================================
-- Test: user_has_role function exists and has correct signature
-- ============================================================================

SELECT has_function(
    'public',
    'user_has_role',
    ARRAY['uuid', 'text[]'],
    'user_has_role function should exist'
);

SELECT function_returns(
    'public',
    'user_has_role',
    ARRAY['uuid', 'text[]'],
    'boolean',
    'user_has_role should return boolean'
);

SELECT function_lang_is(
    'public',
    'user_has_role',
    ARRAY['uuid', 'text[]'],
    'sql',
    'user_has_role should be sql'
);

SELECT volatility_is(
    'public',
    'user_has_role',
    ARRAY['uuid', 'text[]'],
    'stable',
    'user_has_role should be stable'
);

-- ============================================================================
-- Test: user_is_internal_team function exists and has correct signature
-- ============================================================================

SELECT has_function(
    'public',
    'user_is_internal_team',
    ARRAY['uuid'],
    'user_is_internal_team function should exist'
);

SELECT function_returns(
    'public',
    'user_is_internal_team',
    ARRAY['uuid'],
    'boolean',
    'user_is_internal_team should return boolean'
);

SELECT function_lang_is(
    'public',
    'user_is_internal_team',
    ARRAY['uuid'],
    'sql',
    'user_is_internal_team should be sql'
);

SELECT volatility_is(
    'public',
    'user_is_internal_team',
    ARRAY['uuid'],
    'stable',
    'user_is_internal_team should be stable'
);

-- ============================================================================
-- Test: user_is_collaborator function exists and has correct signature
-- ============================================================================

SELECT has_function(
    'public',
    'user_is_collaborator',
    ARRAY['uuid'],
    'user_is_collaborator function should exist'
);

SELECT function_returns(
    'public',
    'user_is_collaborator',
    ARRAY['uuid'],
    'boolean',
    'user_is_collaborator should return boolean'
);

SELECT function_lang_is(
    'public',
    'user_is_collaborator',
    ARRAY['uuid'],
    'sql',
    'user_is_collaborator should be sql'
);

SELECT volatility_is(
    'public',
    'user_is_collaborator',
    ARRAY['uuid'],
    'stable',
    'user_is_collaborator should be stable'
);

-- ============================================================================
-- Test: user_has_capability function exists and has correct signature
-- ============================================================================

SELECT has_function(
    'public',
    'user_has_capability',
    ARRAY['uuid', 'text'],
    'user_has_capability function should exist'
);

SELECT function_returns(
    'public',
    'user_has_capability',
    ARRAY['uuid', 'text'],
    'boolean',
    'user_has_capability should return boolean'
);

SELECT function_lang_is(
    'public',
    'user_has_capability',
    ARRAY['uuid', 'text'],
    'plpgsql',
    'user_has_capability should be plpgsql'
);

SELECT volatility_is(
    'public',
    'user_has_capability',
    ARRAY['uuid', 'text'],
    'stable',
    'user_has_capability should be stable'
);

-- ============================================================================
-- Test: All functions are SECURITY DEFINER
-- ============================================================================

SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'user_has_role'),
    TRUE,
    'user_has_role should be SECURITY DEFINER'
);

SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'user_is_internal_team'),
    TRUE,
    'user_is_internal_team should be SECURITY DEFINER'
);

SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'user_is_collaborator'),
    TRUE,
    'user_is_collaborator should be SECURITY DEFINER'
);

SELECT is(
    (SELECT prosecdef FROM pg_proc WHERE proname = 'user_has_capability'),
    TRUE,
    'user_has_capability should be SECURITY DEFINER'
);

-- ============================================================================
-- Test: Role constraint includes collaborator roles
-- ============================================================================

SELECT ok(
    (
        SELECT conname IS NOT NULL
        FROM pg_constraint
        WHERE conname = 'user_restaurants_role_check'
          AND conrelid = 'public.user_restaurants'::regclass
    ),
    'user_restaurants should have role_check constraint'
);

-- Verify the constraint allows collaborator roles by checking the constraint definition
SELECT ok(
    (
        SELECT pg_get_constraintdef(oid) LIKE '%collaborator_accountant%'
           AND pg_get_constraintdef(oid) LIKE '%collaborator_inventory%'
           AND pg_get_constraintdef(oid) LIKE '%collaborator_chef%'
        FROM pg_constraint
        WHERE conname = 'user_restaurants_role_check'
          AND conrelid = 'public.user_restaurants'::regclass
    ),
    'Role constraint should include all collaborator roles'
);

-- ============================================================================
-- Test: Index exists for role-based queries
-- ============================================================================

SELECT has_index(
    'public',
    'user_restaurants',
    'idx_user_restaurants_role',
    'user_restaurants should have role index for performance'
);

-- ============================================================================
-- Test: RLS policy exists on user_restaurants for collaborator isolation
-- ============================================================================

SELECT ok(
    (
        SELECT COUNT(*) > 0
        FROM pg_policies
        WHERE tablename = 'user_restaurants'
          AND policyname LIKE '%view their restaurant associations%'
    ),
    'user_restaurants should have view policy for collaborator isolation'
);

-- ============================================================================
-- Test: user_has_capability covers critical capabilities
-- Note: We test the function definition contains key capabilities
-- ============================================================================

SELECT ok(
    (
        SELECT prosrc LIKE '%view:dashboard%'
           AND prosrc LIKE '%view:transactions%'
           AND prosrc LIKE '%view:inventory%'
           AND prosrc LIKE '%view:recipes%'
           AND prosrc LIKE '%manage:team%'
           AND prosrc LIKE '%manage:collaborators%'
        FROM pg_proc
        WHERE proname = 'user_has_capability'
    ),
    'user_has_capability should define critical capability checks'
);

SELECT ok(
    (
        SELECT prosrc LIKE '%view:pending_outflows%'
           AND prosrc LIKE '%edit:pending_outflows%'
           AND prosrc LIKE '%view:inventory_transactions%'
           AND prosrc LIKE '%edit:inventory_transactions%'
        FROM pg_proc
        WHERE proname = 'user_has_capability'
    ),
    'user_has_capability should define new pending_outflows and inventory_transactions capabilities'
);

-- ============================================================================
-- Test: user_has_capability behavioral tests with fixtures
-- ============================================================================

-- Create idempotent test fixtures
INSERT INTO auth.users (id, email)
VALUES ('19000000-0000-0000-0000-000000000001', 'test-owner-19@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('19000000-0000-0000-0000-000000000002', 'test-accountant-19@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name)
VALUES ('19000000-0000-0000-0000-000000000099', 'Test Restaurant 19')
ON CONFLICT (id) DO NOTHING;

-- Create owner role
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '19000000-0000-0000-0000-000000000101',
    '19000000-0000-0000-0000-000000000001',
    '19000000-0000-0000-0000-000000000099',
    'owner'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Create collaborator_accountant role
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '19000000-0000-0000-0000-000000000102',
    '19000000-0000-0000-0000-000000000002',
    '19000000-0000-0000-0000-000000000099',
    'collaborator_accountant'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_accountant';

-- Test: Owner should have view:dashboard capability
SELECT set_config('request.jwt.claims', '{"sub":"19000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'view:dashboard'),
    TRUE,
    'user_has_capability returns TRUE for owner with view:dashboard'
);

-- Test: Owner should have manage:team capability
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'manage:team'),
    TRUE,
    'user_has_capability returns TRUE for owner with manage:team'
);

-- Test: Owner should NOT have unknown capability
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'nonexistent:capability'),
    FALSE,
    'user_has_capability returns FALSE for unknown capability'
);

-- Test: Collaborator accountant should have view:transactions capability
SELECT set_config('request.jwt.claims', '{"sub":"19000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'view:transactions'),
    TRUE,
    'user_has_capability returns TRUE for collaborator_accountant with view:transactions'
);

-- Test: Collaborator accountant should NOT have view:dashboard capability
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'view:dashboard'),
    FALSE,
    'user_has_capability returns FALSE for collaborator_accountant with view:dashboard'
);

-- Test: Collaborator accountant should NOT have manage:team capability
SELECT is(
    public.user_has_capability('19000000-0000-0000-0000-000000000099'::uuid, 'manage:team'),
    FALSE,
    'user_has_capability returns FALSE for collaborator_accountant with manage:team'
);

SELECT * FROM finish();
ROLLBACK;
