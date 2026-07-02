-- ============================================================================
-- Tests: operations_manager capability sentinel (drift guard)
--
-- Asserts that user_has_capability() returns TRUE for every operational
-- capability that operations_manager is entitled to, and FALSE for every
-- accounting and excluded-admin capability.
--
-- This is the authoritative drift guard: if someone edits user_has_capability
-- and accidentally grants an accounting capability to operations_manager, or
-- removes an operational one, these tests will catch the regression.
--
-- Fixture namespace: UUIDs starting with 21000000-...
-- ============================================================================

BEGIN;
SELECT plan(30);

-- ============================================================================
-- Fixtures
-- ============================================================================

-- Auth user for operations_manager role
INSERT INTO auth.users (id, email)
VALUES ('21000000-0000-0000-0000-000000000001', 'test-ops-mgr-21@example.com')
ON CONFLICT (id) DO NOTHING;

-- Restaurant
INSERT INTO public.restaurants (id, name)
VALUES ('21000000-0000-0000-0000-000000000099', 'Test Restaurant 21')
ON CONFLICT (id) DO NOTHING;

-- Assign operations_manager role
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
VALUES (
    '21000000-0000-0000-0000-000000000101',
    '21000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000099',
    'operations_manager'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'operations_manager';

-- Set auth.uid() to the operations_manager user for this session
SELECT set_config('request.jwt.claims', '{"sub":"21000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

-- ============================================================================
-- INCLUDED capabilities -> must return TRUE
-- ============================================================================

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:inventory'),
    TRUE,
    'ops-mgr has view:inventory'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
    TRUE,
    'ops-mgr has edit:inventory'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:recipes'),
    TRUE,
    'ops-mgr has edit:recipes'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:pos_sales'),
    TRUE,
    'ops-mgr has view:pos_sales'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:scheduling'),
    TRUE,
    'ops-mgr has edit:scheduling'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:payroll'),
    TRUE,
    'ops-mgr has edit:payroll'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:tips'),
    TRUE,
    'ops-mgr has edit:tips'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:time_punches'),
    TRUE,
    'ops-mgr has edit:time_punches'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'manage:employees'),
    TRUE,
    'ops-mgr has manage:employees'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'manage:team'),
    TRUE,
    'ops-mgr has manage:team'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:team'),
    TRUE,
    'ops-mgr has view:team'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:reports'),
    TRUE,
    'ops-mgr has view:reports'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:receipt_import'),
    TRUE,
    'ops-mgr has edit:receipt_import'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:settings'),
    TRUE,
    'ops-mgr has view:settings'
);

-- ============================================================================
-- EXCLUDED accounting capabilities -> must return FALSE
-- ============================================================================

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:transactions'),
    FALSE,
    'ops-mgr denied view:transactions (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:transactions'),
    FALSE,
    'ops-mgr denied edit:transactions (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:banking'),
    FALSE,
    'ops-mgr denied view:banking (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:expenses'),
    FALSE,
    'ops-mgr denied view:expenses (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:financial_statements'),
    FALSE,
    'ops-mgr denied view:financial_statements (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:chart_of_accounts'),
    FALSE,
    'ops-mgr denied view:chart_of_accounts (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:invoices'),
    FALSE,
    'ops-mgr denied view:invoices (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:customers'),
    FALSE,
    'ops-mgr denied view:customers (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:pending_outflows'),
    FALSE,
    'ops-mgr denied view:pending_outflows (accounting/AP)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:financial_intelligence'),
    FALSE,
    'ops-mgr denied view:financial_intelligence (accounting)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:assets'),
    FALSE,
    'ops-mgr denied view:assets (accounting)'
);

-- ============================================================================
-- EXCLUDED admin capabilities -> must return FALSE
-- ============================================================================

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'edit:settings'),
    FALSE,
    'ops-mgr denied edit:settings (admin)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'view:integrations'),
    FALSE,
    'ops-mgr denied view:integrations (admin)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'manage:integrations'),
    FALSE,
    'ops-mgr denied manage:integrations (admin)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'manage:collaborators'),
    FALSE,
    'ops-mgr denied manage:collaborators (admin)'
);

SELECT is(
    public.user_has_capability('21000000-0000-0000-0000-000000000099'::uuid, 'manage:subscription'),
    FALSE,
    'ops-mgr denied manage:subscription (admin)'
);

SELECT * FROM finish();
ROLLBACK;
