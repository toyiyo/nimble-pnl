-- ============================================================================
-- roles_seed_test.sql
--
-- Task 2 of the "data-driven roles built from areas" design: pgTAP coverage
-- for the ten seeded builtin roles (supabase/migrations/
-- 20260730110000_seed_builtin_roles.sql). See
-- docs/superpowers/specs/2026-07-29-roles-and-areas-design.md and
-- docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md, Task 2.
--
-- This is the regression net for the whole design: for each of the ten
-- builtin roles, the capability set derived mechanically from its seeded
-- role_areas (+ role_flags) rows must equal, byte-for-byte, the legacy
-- ROLE_CAPABILITIES entry for that role (src/lib/permissions/definitions.ts).
-- Both directions are asserted per role — missing (under-grant) and extra
-- (over-grant) — so the test fails just as hard on a role that was granted
-- too much as one that was granted too little.
--
-- Two fixture tables encode the independently-derived expectation, entirely
-- decoupled from the migration's own area_key/level choices:
--   test_area_capability_at_level — for every (area_key, level) pair among
--     the 27 (of 33) area_catalog keys that map to a legacy Capability, the
--     full set of legacy Capability strings that tier bundles. The 'manage'
--     tier's capability list is always the total union (view-tier
--     capabilities plus manage-tier additions), so a plain join against a
--     role's granted level needs no cumulative logic. Six re-cut keys —
--     ops_inbox, weekly_brief, budget, labor, stripe_account, assets — are
--     deliberately absent: none of them corresponds to a legacy Capability
--     string (assets was reachable pre-migration only as one of the nine
--     `books` pages, never its own capability), so a role_areas row for any
--     of them contributes nothing to derived_capabilities below, same as
--     omitting it here. (`assets` does have `view:assets`/`edit:assets`
--     capability strings in `user_has_capability` — it's excluded from this
--     fixture only because those strings aren't in the ROLE_CAPABILITIES
--     fixed-point being reconstructed here, not because they don't exist.)
--   test_expected_capabilities — the untouched ROLE_CAPABILITIES arrays,
--     transcribed capability-by-capability from definitions.ts, keyed by
--     the role's display name (the seed's roles.name convention, matching
--     the 'Owner' fixture already established in roles_schema_test.sql).
--
-- All fixture data is fictional/transcribed reference data and exists only
-- for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(25);

-- ----------------------------------------------------------------------------
-- Fixture 1: area_key/level -> legacy capability bundle (84 rows, 27 areas).
-- Re-derived from 20260805120000_page_areas.sql's user_has_capability VALUES
-- map (Step 4) plus its two hardcoded special cases (view:ai_assistant off
-- reports:manage, view:financial_intelligence off its own area at either
-- level) — NOT from the pre-migration `books` bundle this replaces.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE test_area_capability_at_level (
  area_key TEXT NOT NULL,
  level TEXT NOT NULL,
  capability TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO test_area_capability_at_level (area_key, level, capability) VALUES
  ('dashboard', 'view', 'view:dashboard'),
  ('dashboard', 'manage', 'view:dashboard'),
  ('reports', 'view', 'view:reports'),
  ('reports', 'manage', 'view:reports'),
  ('reports', 'manage', 'view:ai_assistant'),
  ('sales', 'view', 'view:pos_sales'),
  ('sales', 'manage', 'view:pos_sales'),
  ('inventory', 'view', 'view:inventory'),
  ('inventory', 'manage', 'view:inventory'),
  ('inventory', 'manage', 'edit:inventory'),
  ('inventory', 'manage', 'view:receipt_import'),
  ('inventory', 'manage', 'edit:receipt_import'),
  ('inventory', 'manage', 'view:inventory_transactions'),
  ('inventory', 'manage', 'edit:inventory_transactions'),
  ('inventory_audit', 'view', 'view:inventory_audit'),
  ('inventory_audit', 'manage', 'view:inventory_audit'),
  ('inventory_audit', 'manage', 'edit:inventory_audit'),
  ('purchasing', 'view', 'view:purchase_orders'),
  ('purchasing', 'manage', 'view:purchase_orders'),
  ('purchasing', 'manage', 'edit:purchase_orders'),
  ('recipes', 'view', 'view:recipes'),
  ('recipes', 'view', 'view:batches'),
  ('recipes', 'manage', 'view:recipes'),
  ('recipes', 'manage', 'view:batches'),
  ('recipes', 'manage', 'edit:recipes'),
  ('recipes', 'manage', 'edit:batches'),
  ('prep_recipes', 'view', 'view:prep_recipes'),
  ('prep_recipes', 'manage', 'view:prep_recipes'),
  ('prep_recipes', 'manage', 'edit:prep_recipes'),
  ('scheduling', 'view', 'view:scheduling'),
  ('scheduling', 'manage', 'view:scheduling'),
  ('scheduling', 'manage', 'edit:scheduling'),
  ('tips', 'view', 'view:tips'),
  ('tips', 'manage', 'view:tips'),
  ('tips', 'manage', 'edit:tips'),
  ('time_punches', 'view', 'view:time_punches'),
  ('time_punches', 'manage', 'view:time_punches'),
  ('time_punches', 'manage', 'edit:time_punches'),
  ('transactions', 'view', 'view:transactions'),
  ('transactions', 'manage', 'view:transactions'),
  ('transactions', 'manage', 'edit:transactions'),
  ('banking', 'view', 'view:banking'),
  ('banking', 'manage', 'view:banking'),
  ('banking', 'manage', 'edit:banking'),
  ('expenses', 'view', 'view:expenses'),
  ('expenses', 'manage', 'view:expenses'),
  ('expenses', 'manage', 'edit:expenses'),
  ('financial_statements', 'view', 'view:financial_statements'),
  ('financial_statements', 'manage', 'view:financial_statements'),
  ('invoices', 'view', 'view:invoices'),
  ('invoices', 'manage', 'view:invoices'),
  ('invoices', 'manage', 'edit:invoices'),
  ('customers', 'view', 'view:customers'),
  ('customers', 'manage', 'view:customers'),
  ('customers', 'manage', 'edit:customers'),
  ('print_checks', 'view', 'view:pending_outflows'),
  ('print_checks', 'manage', 'view:pending_outflows'),
  ('print_checks', 'manage', 'edit:pending_outflows'),
  ('financial_intelligence', 'view', 'view:financial_intelligence'),
  ('financial_intelligence', 'manage', 'view:financial_intelligence'),
  ('chart_of_accounts', 'view', 'view:chart_of_accounts'),
  ('chart_of_accounts', 'manage', 'view:chart_of_accounts'),
  ('chart_of_accounts', 'manage', 'edit:chart_of_accounts'),
  ('payroll', 'view', 'view:payroll'),
  ('payroll', 'manage', 'view:payroll'),
  ('payroll', 'manage', 'edit:payroll'),
  ('employees', 'view', 'view:employees'),
  ('employees', 'manage', 'view:employees'),
  ('employees', 'manage', 'manage:employees'),
  ('team', 'view', 'view:team'),
  ('team', 'manage', 'view:team'),
  ('team', 'manage', 'manage:team'),
  ('collaborators', 'view', 'view:collaborators'),
  ('collaborators', 'manage', 'view:collaborators'),
  ('collaborators', 'manage', 'manage:collaborators'),
  ('settings', 'view', 'view:settings'),
  ('settings', 'manage', 'view:settings'),
  ('settings', 'manage', 'edit:settings'),
  ('integrations', 'view', 'view:integrations'),
  ('integrations', 'manage', 'view:integrations'),
  ('integrations', 'manage', 'manage:integrations'),
  ('reviews', 'view', 'view:reviews'),
  ('reviews', 'manage', 'view:reviews'),
  ('reviews', 'manage', 'manage:reviews');

-- ----------------------------------------------------------------------------
-- Fixture 2: expected ROLE_CAPABILITIES per role, keyed by display name
-- (233 rows across 9 roles; Kiosk deliberately contributes zero rows since
-- ROLE_CAPABILITIES.kiosk = []).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE test_expected_capabilities (
  role_name TEXT NOT NULL,
  capability TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO test_expected_capabilities (role_name, capability) VALUES
  ('Owner', 'view:dashboard'),
  ('Owner', 'view:ai_assistant'),
  ('Owner', 'view:transactions'),
  ('Owner', 'edit:transactions'),
  ('Owner', 'view:banking'),
  ('Owner', 'edit:banking'),
  ('Owner', 'view:expenses'),
  ('Owner', 'edit:expenses'),
  ('Owner', 'view:financial_statements'),
  ('Owner', 'view:chart_of_accounts'),
  ('Owner', 'edit:chart_of_accounts'),
  ('Owner', 'view:invoices'),
  ('Owner', 'edit:invoices'),
  ('Owner', 'view:customers'),
  ('Owner', 'edit:customers'),
  ('Owner', 'view:financial_intelligence'),
  ('Owner', 'view:inventory'),
  ('Owner', 'edit:inventory'),
  ('Owner', 'view:inventory_audit'),
  ('Owner', 'edit:inventory_audit'),
  ('Owner', 'view:purchase_orders'),
  ('Owner', 'edit:purchase_orders'),
  ('Owner', 'view:receipt_import'),
  ('Owner', 'edit:receipt_import'),
  ('Owner', 'view:reports'),
  ('Owner', 'view:pending_outflows'),
  ('Owner', 'edit:pending_outflows'),
  ('Owner', 'view:inventory_transactions'),
  ('Owner', 'edit:inventory_transactions'),
  ('Owner', 'view:recipes'),
  ('Owner', 'edit:recipes'),
  ('Owner', 'view:prep_recipes'),
  ('Owner', 'edit:prep_recipes'),
  ('Owner', 'view:batches'),
  ('Owner', 'edit:batches'),
  ('Owner', 'view:pos_sales'),
  ('Owner', 'view:scheduling'),
  ('Owner', 'edit:scheduling'),
  ('Owner', 'view:payroll'),
  ('Owner', 'edit:payroll'),
  ('Owner', 'view:tips'),
  ('Owner', 'edit:tips'),
  ('Owner', 'view:time_punches'),
  ('Owner', 'edit:time_punches'),
  ('Owner', 'view:team'),
  ('Owner', 'manage:team'),
  ('Owner', 'view:employees'),
  ('Owner', 'manage:employees'),
  ('Owner', 'view:settings'),
  ('Owner', 'edit:settings'),
  ('Owner', 'view:integrations'),
  ('Owner', 'manage:integrations'),
  ('Owner', 'view:collaborators'),
  ('Owner', 'manage:collaborators'),
  ('Owner', 'view:reviews'),
  ('Owner', 'manage:reviews'),
  ('Manager', 'view:dashboard'),
  ('Manager', 'view:ai_assistant'),
  ('Manager', 'view:transactions'),
  ('Manager', 'edit:transactions'),
  ('Manager', 'view:banking'),
  ('Manager', 'edit:banking'),
  ('Manager', 'view:expenses'),
  ('Manager', 'edit:expenses'),
  ('Manager', 'view:financial_statements'),
  ('Manager', 'view:chart_of_accounts'),
  ('Manager', 'view:invoices'),
  ('Manager', 'edit:invoices'),
  ('Manager', 'view:customers'),
  ('Manager', 'edit:customers'),
  ('Manager', 'view:financial_intelligence'),
  ('Manager', 'view:inventory'),
  ('Manager', 'edit:inventory'),
  ('Manager', 'view:inventory_audit'),
  ('Manager', 'edit:inventory_audit'),
  ('Manager', 'view:purchase_orders'),
  ('Manager', 'edit:purchase_orders'),
  ('Manager', 'view:receipt_import'),
  ('Manager', 'edit:receipt_import'),
  ('Manager', 'view:reports'),
  ('Manager', 'view:pending_outflows'),
  ('Manager', 'edit:pending_outflows'),
  ('Manager', 'view:inventory_transactions'),
  ('Manager', 'edit:inventory_transactions'),
  ('Manager', 'view:recipes'),
  ('Manager', 'edit:recipes'),
  ('Manager', 'view:prep_recipes'),
  ('Manager', 'edit:prep_recipes'),
  ('Manager', 'view:batches'),
  ('Manager', 'edit:batches'),
  ('Manager', 'view:pos_sales'),
  ('Manager', 'view:scheduling'),
  ('Manager', 'edit:scheduling'),
  ('Manager', 'view:payroll'),
  ('Manager', 'edit:payroll'),
  ('Manager', 'view:tips'),
  ('Manager', 'edit:tips'),
  ('Manager', 'view:time_punches'),
  ('Manager', 'edit:time_punches'),
  ('Manager', 'view:team'),
  ('Manager', 'manage:team'),
  ('Manager', 'view:employees'),
  ('Manager', 'manage:employees'),
  ('Manager', 'view:settings'),
  ('Manager', 'view:integrations'),
  ('Manager', 'view:collaborators'),
  ('Manager', 'manage:collaborators'),
  ('Manager', 'view:reviews'),
  ('Manager', 'manage:reviews'),
  ('Operations Manager', 'view:dashboard'),
  ('Operations Manager', 'view:ai_assistant'),
  ('Operations Manager', 'view:inventory'),
  ('Operations Manager', 'edit:inventory'),
  ('Operations Manager', 'view:inventory_audit'),
  ('Operations Manager', 'edit:inventory_audit'),
  ('Operations Manager', 'view:purchase_orders'),
  ('Operations Manager', 'edit:purchase_orders'),
  ('Operations Manager', 'view:receipt_import'),
  ('Operations Manager', 'edit:receipt_import'),
  ('Operations Manager', 'view:reports'),
  ('Operations Manager', 'view:inventory_transactions'),
  ('Operations Manager', 'edit:inventory_transactions'),
  ('Operations Manager', 'view:recipes'),
  ('Operations Manager', 'edit:recipes'),
  ('Operations Manager', 'view:prep_recipes'),
  ('Operations Manager', 'edit:prep_recipes'),
  ('Operations Manager', 'view:batches'),
  ('Operations Manager', 'edit:batches'),
  ('Operations Manager', 'view:pos_sales'),
  ('Operations Manager', 'view:scheduling'),
  ('Operations Manager', 'edit:scheduling'),
  ('Operations Manager', 'view:payroll'),
  ('Operations Manager', 'edit:payroll'),
  ('Operations Manager', 'view:tips'),
  ('Operations Manager', 'edit:tips'),
  ('Operations Manager', 'view:time_punches'),
  ('Operations Manager', 'edit:time_punches'),
  ('Operations Manager', 'view:team'),
  ('Operations Manager', 'manage:team'),
  ('Operations Manager', 'view:employees'),
  ('Operations Manager', 'manage:employees'),
  ('Operations Manager', 'view:settings'),
  ('Operations Manager', 'view:reviews'),
  ('Operations Manager', 'manage:reviews'),
  ('Chef', 'view:dashboard'),
  ('Chef', 'view:inventory'),
  ('Chef', 'edit:inventory'),
  ('Chef', 'view:inventory_audit'),
  ('Chef', 'edit:inventory_audit'),
  ('Chef', 'view:purchase_orders'),
  ('Chef', 'view:receipt_import'),
  ('Chef', 'edit:receipt_import'),
  ('Chef', 'view:reports'),
  ('Chef', 'view:inventory_transactions'),
  ('Chef', 'edit:inventory_transactions'),
  ('Chef', 'view:recipes'),
  ('Chef', 'edit:recipes'),
  ('Chef', 'view:prep_recipes'),
  ('Chef', 'edit:prep_recipes'),
  ('Chef', 'view:batches'),
  ('Chef', 'edit:batches'),
  ('Chef', 'view:pos_sales'),
  ('Chef', 'view:scheduling'),
  ('Chef', 'view:settings'),
  ('Chef', 'view:reviews'),
  ('Employee (self-service)', 'view:settings'),
  ('Accountant', 'view:transactions'),
  ('Accountant', 'edit:transactions'),
  ('Accountant', 'view:banking'),
  ('Accountant', 'edit:banking'),
  ('Accountant', 'view:expenses'),
  ('Accountant', 'edit:expenses'),
  ('Accountant', 'view:financial_statements'),
  ('Accountant', 'view:chart_of_accounts'),
  ('Accountant', 'edit:chart_of_accounts'),
  ('Accountant', 'view:invoices'),
  ('Accountant', 'edit:invoices'),
  ('Accountant', 'view:customers'),
  ('Accountant', 'edit:customers'),
  ('Accountant', 'view:financial_intelligence'),
  ('Accountant', 'view:pending_outflows'),
  ('Accountant', 'edit:pending_outflows'),
  ('Accountant', 'view:payroll'),
  ('Accountant', 'view:employees'),
  ('Accountant', 'view:settings'),
  ('Inventory Helper', 'view:inventory'),
  ('Inventory Helper', 'edit:inventory'),
  ('Inventory Helper', 'view:inventory_audit'),
  ('Inventory Helper', 'edit:inventory_audit'),
  ('Inventory Helper', 'view:purchase_orders'),
  ('Inventory Helper', 'edit:purchase_orders'),
  ('Inventory Helper', 'view:receipt_import'),
  ('Inventory Helper', 'edit:receipt_import'),
  ('Inventory Helper', 'view:inventory_transactions'),
  ('Inventory Helper', 'edit:inventory_transactions'),
  ('Inventory Helper', 'view:settings'),
  ('Recipe Consultant', 'view:recipes'),
  ('Recipe Consultant', 'edit:recipes'),
  ('Recipe Consultant', 'view:prep_recipes'),
  ('Recipe Consultant', 'edit:prep_recipes'),
  ('Recipe Consultant', 'view:batches'),
  ('Recipe Consultant', 'edit:batches'),
  ('Recipe Consultant', 'view:inventory'),
  ('Recipe Consultant', 'view:settings'),
  ('Operations Manager (Collaborator)', 'view:dashboard'),
  ('Operations Manager (Collaborator)', 'view:ai_assistant'),
  ('Operations Manager (Collaborator)', 'view:inventory'),
  ('Operations Manager (Collaborator)', 'edit:inventory'),
  ('Operations Manager (Collaborator)', 'view:inventory_audit'),
  ('Operations Manager (Collaborator)', 'edit:inventory_audit'),
  ('Operations Manager (Collaborator)', 'view:purchase_orders'),
  ('Operations Manager (Collaborator)', 'edit:purchase_orders'),
  ('Operations Manager (Collaborator)', 'view:receipt_import'),
  ('Operations Manager (Collaborator)', 'edit:receipt_import'),
  ('Operations Manager (Collaborator)', 'view:reports'),
  ('Operations Manager (Collaborator)', 'view:inventory_transactions'),
  ('Operations Manager (Collaborator)', 'edit:inventory_transactions'),
  ('Operations Manager (Collaborator)', 'view:recipes'),
  ('Operations Manager (Collaborator)', 'edit:recipes'),
  ('Operations Manager (Collaborator)', 'view:prep_recipes'),
  ('Operations Manager (Collaborator)', 'edit:prep_recipes'),
  ('Operations Manager (Collaborator)', 'view:batches'),
  ('Operations Manager (Collaborator)', 'edit:batches'),
  ('Operations Manager (Collaborator)', 'view:pos_sales'),
  ('Operations Manager (Collaborator)', 'view:scheduling'),
  ('Operations Manager (Collaborator)', 'edit:scheduling'),
  ('Operations Manager (Collaborator)', 'view:time_punches'),
  ('Operations Manager (Collaborator)', 'edit:time_punches'),
  ('Operations Manager (Collaborator)', 'view:tips'),
  ('Operations Manager (Collaborator)', 'edit:tips'),
  ('Operations Manager (Collaborator)', 'view:payroll'),
  ('Operations Manager (Collaborator)', 'view:employees'),
  ('Operations Manager (Collaborator)', 'view:settings');

-- ----------------------------------------------------------------------------
-- derived_capabilities: what the seed actually produces, computed purely
-- from the migration's role_areas rows joined against fixture 1 above. Built
-- once as a temp table so every per-role assertion below queries the same
-- materialized result.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE derived_capabilities AS
SELECT r.name AS role_name, acal.capability
FROM public.roles r
JOIN public.role_areas ra ON ra.role_id = r.id
JOIN test_area_capability_at_level acal
  ON acal.area_key = ra.area_key AND acal.level = ra.level
WHERE r.builtin = true AND r.restaurant_id IS NULL;

-- ============================================================================
-- 1. Shape: exactly ten global builtins, split six platform / four
--    collaborator, per the plan's flavor assignment.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE builtin = true AND restaurant_id IS NULL),
  10,
  'exactly ten builtin roles are seeded, all global (restaurant_id IS NULL)'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles
   WHERE builtin = true AND restaurant_id IS NULL AND flavor = 'platform'),
  6,
  'six builtins are flavor=platform (owner, manager, operations_manager, chef, staff, kiosk)'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles
   WHERE builtin = true AND restaurant_id IS NULL AND flavor = 'collaborator'),
  4,
  'four builtins are flavor=collaborator (the four collaborator presets)'
);

SELECT set_eq(
  $$SELECT name FROM public.roles WHERE builtin = true AND restaurant_id IS NULL$$,
  ARRAY[
    'Owner', 'Manager', 'Operations Manager', 'Chef',
    'Employee (self-service)', 'Kiosk', 'Accountant', 'Inventory Helper',
    'Recipe Consultant', 'Operations Manager (Collaborator)'
  ],
  'the ten builtin display names match ROLE_METADATA labels exactly'
);

-- ============================================================================
-- 2. No role_flags rows are seeded for any builtin: the three sensitive
--    flags have no equivalent in the legacy Capability union, so seeding any
--    of them here would immediately break the round-trip property below.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.role_flags rf
   JOIN public.roles r ON r.id = rf.role_id
   WHERE r.builtin = true AND r.restaurant_id IS NULL),
  0,
  'zero role_flags rows are seeded for any builtin role'
);

-- ============================================================================
-- 3. Byte-identical round trip, both directions, for every builtin role.
--    "Missing" = expected capability the seed fails to grant (under-grant).
--    "Extra"   = granted capability absent from ROLE_CAPABILITIES (over-grant).
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Owner'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Owner: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Owner'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Owner: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Manager'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Manager: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Manager'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Manager: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Operations Manager'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Operations Manager: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Operations Manager'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Operations Manager: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Chef'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Chef: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Chef'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Chef: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Employee (self-service)'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Employee (self-service): no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Employee (self-service)'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Employee (self-service): no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Kiosk'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Kiosk: no missing capabilities (ROLE_CAPABILITIES.kiosk is empty)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Kiosk'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Kiosk: no extra capabilities (zero role_areas rows seeded)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Accountant'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Accountant: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Accountant'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Accountant: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Inventory Helper'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Inventory Helper: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Inventory Helper'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Inventory Helper: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Recipe Consultant'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Recipe Consultant: no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Recipe Consultant'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Recipe Consultant: no extra capabilities (over-grant)'
);

SELECT is(
  (SELECT count(*)::int FROM test_expected_capabilities e
   WHERE e.role_name = 'Operations Manager (Collaborator)'
     AND NOT EXISTS (SELECT 1 FROM derived_capabilities d
                     WHERE d.role_name = e.role_name AND d.capability = e.capability)),
  0, 'Operations Manager (Collaborator): no missing capabilities (under-grant)'
);
SELECT is(
  (SELECT count(*)::int FROM derived_capabilities d
   WHERE d.role_name = 'Operations Manager (Collaborator)'
     AND NOT EXISTS (SELECT 1 FROM test_expected_capabilities e
                     WHERE e.role_name = d.role_name AND e.capability = d.capability)),
  0, 'Operations Manager (Collaborator): no extra capabilities (over-grant)'
);

SELECT * FROM finish();
ROLLBACK;
