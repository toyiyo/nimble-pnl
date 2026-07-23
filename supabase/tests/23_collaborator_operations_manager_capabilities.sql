-- ============================================================================
-- Tests: collaborator_operations_manager capability sentinel (drift guard)
--
-- Asserts that user_has_capability() returns TRUE for every operational
-- capability collaborator_operations_manager is entitled to (mirrors
-- operations_manager's operational surface, minus team/manage-employees/
-- edit-payroll, plus read-only view:payroll and view:employees), and FALSE
-- for every accounting, admin, and internal-team-only capability.
--
-- This is the authoritative drift guard: if someone edits user_has_capability
-- and accidentally grants an accounting/admin/team capability to
-- collaborator_operations_manager, or removes a granted operational one,
-- these tests will catch the regression.
--
-- Fixture namespace: UUIDs starting with 23000000-...
-- Mirrors: supabase/tests/21_operations_manager_capabilities.sql
-- ============================================================================

BEGIN;
SELECT plan(24);

-- ============================================================================
-- Fixtures
-- ============================================================================

-- Auth user for collaborator_operations_manager role
INSERT INTO auth.users (id, email)
VALUES ('23000000-0000-0000-0000-000000000001', 'test-collab-ops-mgr-23@example.com')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name)
VALUES ('23000000-0000-0000-0000-000000000099', 'Test Restaurant 23')
ON CONFLICT (id) DO NOTHING;

-- Assign collaborator_operations_manager role
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '23000000-0000-0000-0000-000000000101',
    '23000000-0000-0000-0000-000000000001',
    '23000000-0000-0000-0000-000000000099',
    'collaborator_operations_manager'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_operations_manager';

-- Set auth.uid() to the collaborator_operations_manager user for this session
SELECT set_config('request.jwt.claims', '{"sub":"23000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- ============================================================================
-- INCLUDED capabilities -> must return TRUE
-- ============================================================================

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:inventory'),
    TRUE,
    'collab-ops-mgr has view:inventory'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
    TRUE,
    'collab-ops-mgr has edit:inventory'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:recipes'),
    TRUE,
    'collab-ops-mgr has edit:recipes'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:pos_sales'),
    TRUE,
    'collab-ops-mgr has view:pos_sales'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:scheduling'),
    TRUE,
    'collab-ops-mgr has view:scheduling'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:scheduling'),
    TRUE,
    'collab-ops-mgr has edit:scheduling'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:tips'),
    TRUE,
    'collab-ops-mgr has edit:tips'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:time_punches'),
    TRUE,
    'collab-ops-mgr has edit:time_punches'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:receipt_import'),
    TRUE,
    'collab-ops-mgr has edit:receipt_import'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:settings'),
    TRUE,
    'collab-ops-mgr has view:settings'
);

-- Read-only labor-context capabilities (the key delta vs operations_manager)
SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:payroll'),
    TRUE,
    'collab-ops-mgr has view:payroll (read-only)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:employees'),
    TRUE,
    'collab-ops-mgr has view:employees (read-only)'
);

-- ============================================================================
-- EXCLUDED capabilities dropped relative to operations_manager -> must be FALSE
-- ============================================================================

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:team'),
    FALSE,
    'collab-ops-mgr denied view:team (internal-team-only)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'manage:team'),
    FALSE,
    'collab-ops-mgr denied manage:team (internal-team-only)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'manage:employees'),
    FALSE,
    'collab-ops-mgr denied manage:employees (dropped — view:employees only)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:payroll'),
    FALSE,
    'collab-ops-mgr denied edit:payroll (view-only payroll)'
);

-- ============================================================================
-- EXCLUDED accounting capabilities -> must return FALSE
-- ============================================================================

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:transactions'),
    FALSE,
    'collab-ops-mgr denied view:transactions (accounting)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:banking'),
    FALSE,
    'collab-ops-mgr denied view:banking (accounting)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:chart_of_accounts'),
    FALSE,
    'collab-ops-mgr denied view:chart_of_accounts (accounting)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:financial_intelligence'),
    FALSE,
    'collab-ops-mgr denied view:financial_intelligence (accounting)'
);

-- ============================================================================
-- EXCLUDED admin capabilities -> must return FALSE
-- ============================================================================

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'edit:settings'),
    FALSE,
    'collab-ops-mgr denied edit:settings (admin)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'view:integrations'),
    FALSE,
    'collab-ops-mgr denied view:integrations (admin)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'manage:collaborators'),
    FALSE,
    'collab-ops-mgr denied manage:collaborators (admin)'
);

SELECT is(
    public.user_has_capability('23000000-0000-0000-0000-000000000099'::uuid, 'manage:subscription'),
    FALSE,
    'collab-ops-mgr denied manage:subscription (admin)'
);

SELECT * FROM finish();
ROLLBACK;
