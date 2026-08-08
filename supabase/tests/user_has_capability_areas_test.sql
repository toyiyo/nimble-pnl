-- ============================================================================
-- user_has_capability_areas_test.sql
--
-- Task 5 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). Coverage for
-- the rewritten public.user_has_capability(), which resolves capabilities
-- from role_areas/role_flags when user_restaurants.role_id IS NOT NULL, and
-- falls back to the legacy role-literal CASE (verbatim) when it IS NULL.
--
-- Fixture, NOT self-referential: pg_temp.legacy_user_has_capability(p_role,
-- p_capability, p_restaurant_id) is a hand-transcribed copy of the CASE body
-- from 20260723120000_add_collaborator_operations_manager_role.sql (the
-- function this migration replaces), parameterized on the legacy role
-- string directly instead of looking it up. It exists purely as ground
-- truth for comparison and is never itself the function under test.
--
-- 1. Byte-identical round trip: for all ten builtins x every one of the 57
--    legacy capabilities (+ the 3 new sensitive flags, which the legacy
--    fixture necessarily denies via its ELSE FALSE, since they postdate it),
--    public.user_has_capability() must return exactly what the legacy
--    fixture returns for that builtin's legacy role string.
--
--    ELEVEN sanctioned, documented exceptions, each excluded from the
--    aggregate mismatch count below and asserted explicitly instead:
--
--    - collaborator_inventory (Inventory Helper) + view:reports. The legacy
--      CASE granted it (line ~120 of 20260723120000: 'view:reports' includes
--      collaborator_inventory). The seed migration
--      (20260730110000_seed_builtin_roles.sql) deliberately did NOT grant
--      Inventory Helper a 'reports' area at all, following ROLE_CAPABILITIES
--      (src/lib/permissions/definitions.ts), which never granted
--      collaborator_inventory view:reports either (see PR #596, and the
--      design doc's "Three real defects" section, defect 3: zero production
--      memberships/invitations on this role justified fixing the drift by
--      tightening to match the TypeScript source of truth rather than
--      widening the seed to preserve the SQL-only grant).
--
--    - Ten more: view:pay_rates and view:employee_pii, each granted TRUE on
--      owner, manager, operations_manager, collaborator_accountant, and
--      collaborator_operations_manager by
--      20260806100000_seed_employee_sensitive_flags.sql (the sensitive-data
--      flags design). The legacy CASE predates both flags and denies them
--      through its ELSE FALSE on every role, so this is intended drift, not
--      a bug: the whole point of that migration is to make these flags real
--      for the five roles that hold view:employees.
--
-- 2. user_restaurants.role_id IS NULL falls back to the legacy CASE
--    (denied capability first, then a granted one).
--
-- 2b. The two sensitive flags answer BEFORE that fallback. The legacy CASE
--    denies them through its ELSE FALSE, and create_restaurant_with_owner
--    still leaves role_id NULL, so every new restaurant's owner would lose
--    pay and contact data to the column gate. The branch grants both flags to
--    the five legacy role strings that hold view:employees, and to no other.
--
-- 3. A custom role holding {inventory: manage} gets edit:inventory and not
--    edit:recipes (denied first, then granted).
--
-- 4. Sensitive flags gate independently of area grants: the same custom
--    role, with no view:costs flag, gets edit:inventory but not view:costs
--    (denied first); granting the flag flips view:costs to TRUE without
--    disturbing edit:inventory.
--
-- 4b. Membership is decided by whether a user_restaurants row exists, not by
--    whether the legacy `role` string is populated (that column is nullable).
--    role NULL + role_id set resolves its areas; role NULL + role_id NULL and
--    "no row at all" both fail closed.
--
-- 5. Performance gate: role_areas/role_flags must carry the composite
--    role_id-leading primary-key indexes the rewritten lookup depends on
--    (asserted structurally — see the long comment above those assertions
--    for why pg_stat_user_tables deltas cannot work inside pgTAP's
--    transaction), and the
--    area-based path's actual execution time (EXPLAIN ANALYZE, not
--    estimated cost — user_has_capability is plpgsql + SECURITY DEFINER, so
--    an outer EXPLAIN cannot inline it; only ANALYZE's real elapsed time
--    reflects what happens inside) against products (a table whose RLS
--    already routes through user_has_capability, wired up in
--    20260120100100_update_rls_for_collaborators.sql) must stay within 2x
--    of the legacy-fallback path's execution time on the same data.
--
-- All fixture rows below (auth.users, restaurants, user_restaurants,
-- roles/role_areas/role_flags for the one custom role, and the pg_temp
-- fixture function) exist only for the duration of this transaction
-- (ROLLBACK).
-- ============================================================================

BEGIN;

SELECT plan(36);

-- ----------------------------------------------------------------------------
-- Fixture: legacy CASE, transcribed verbatim and parameterized on p_role.
-- Source: 20260723120000_add_collaborator_operations_manager_role.sql,
-- lines 69-173 (the CREATE OR REPLACE FUNCTION public.user_has_capability
-- body current at the start of this task — i.e. what this migration
-- replaces). Do not "clean up" or reorder branches: byte-identical
-- transcription is the whole point.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.legacy_user_has_capability(
  p_role TEXT,
  p_capability TEXT,
  p_restaurant_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
  IF p_role IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN CASE p_capability
    WHEN 'view:ai_assistant' THEN
      p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager') AND
      has_subscription_feature(p_restaurant_id, 'ai_assistant')

    WHEN 'view:financial_intelligence' THEN
      p_role IN ('owner', 'manager', 'collaborator_accountant') AND
      has_subscription_feature(p_restaurant_id, 'financial_intelligence')

    WHEN 'view:dashboard' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')

    WHEN 'view:transactions' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:transactions' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:banking' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:banking' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:expenses' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:expenses' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:financial_statements' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:chart_of_accounts' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:chart_of_accounts' THEN p_role IN ('owner', 'collaborator_accountant')
    WHEN 'view:invoices' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:invoices' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:customers' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:customers' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:pending_outflows' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:pending_outflows' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'view:assets' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')
    WHEN 'edit:assets' THEN p_role IN ('owner', 'manager', 'collaborator_accountant')

    WHEN 'view:inventory' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:inventory' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:inventory_audit' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:inventory_audit' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:purchase_orders' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:purchase_orders' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:receipt_import' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:receipt_import' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:reports' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'view:inventory_transactions' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')
    WHEN 'edit:inventory_transactions' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_inventory', 'collaborator_operations_manager')

    WHEN 'view:recipes' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:recipes' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'view:prep_recipes' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:prep_recipes' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'view:batches' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')
    WHEN 'edit:batches' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_chef', 'collaborator_operations_manager')

    WHEN 'view:pos_sales' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
    WHEN 'view:scheduling' THEN p_role IN ('owner', 'manager', 'operations_manager', 'chef', 'collaborator_operations_manager')
    WHEN 'edit:scheduling' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'view:payroll' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
    WHEN 'edit:payroll' THEN p_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:tips' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'edit:tips' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'view:time_punches' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')
    WHEN 'edit:time_punches' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_operations_manager')

    WHEN 'view:team' THEN p_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'manage:team' THEN p_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:employees' THEN p_role IN ('owner', 'manager', 'operations_manager', 'collaborator_accountant', 'collaborator_operations_manager')
    WHEN 'manage:employees' THEN p_role IN ('owner', 'manager', 'operations_manager')
    WHEN 'view:settings' THEN p_role NOT IN ('kiosk')
    WHEN 'edit:settings' THEN p_role IN ('owner')
    WHEN 'view:integrations' THEN p_role IN ('owner', 'manager')
    WHEN 'manage:integrations' THEN p_role IN ('owner')
    WHEN 'view:collaborators' THEN p_role IN ('owner', 'manager')
    WHEN 'manage:collaborators' THEN p_role IN ('owner', 'manager')

    WHEN 'manage:subscription' THEN p_role = 'owner'

    ELSE FALSE
  END;
END;
$$;

-- ----------------------------------------------------------------------------
-- Shared restaurant. subscription_tier='pro'/status='active' so the two
-- subscription-gated capabilities (view:ai_assistant, view:financial_
-- intelligence) actually discriminate by role in the matrix below, instead
-- of trivially denying everyone under the trialing default.
-- ----------------------------------------------------------------------------
INSERT INTO public.restaurants (id, name, subscription_tier, subscription_status)
VALUES ('5a000000-0000-0000-0000-000000000099', 'Task 5 Test Restaurant', 'pro', 'active')
ON CONFLICT (id) DO UPDATE SET subscription_tier = 'pro', subscription_status = 'active';

-- ----------------------------------------------------------------------------
-- Ten auth.users + user_restaurants rows, one per builtin, role_id AND the
-- matching legacy role string both set (mirrors what
-- backfill_user_restaurants_role_id() produces in production).
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000101', 'task5-owner@example.com'),
  ('5a000000-0000-0000-0000-000000000102', 'task5-manager@example.com'),
  ('5a000000-0000-0000-0000-000000000103', 'task5-opsmgr@example.com'),
  ('5a000000-0000-0000-0000-000000000104', 'task5-chef@example.com'),
  ('5a000000-0000-0000-0000-000000000105', 'task5-staff@example.com'),
  ('5a000000-0000-0000-0000-000000000106', 'task5-kiosk@example.com'),
  ('5a000000-0000-0000-0000-000000000107', 'task5-accountant@example.com'),
  ('5a000000-0000-0000-0000-000000000108', 'task5-invhelper@example.com'),
  ('5a000000-0000-0000-0000-000000000109', 'task5-recipeconsultant@example.com'),
  ('5a000000-0000-0000-0000-00000000010a', 'task5-collabopsmgr@example.com')
ON CONFLICT (id) DO NOTHING;

CREATE TEMP TABLE test_builtin_roles (
  legacy_role TEXT PRIMARY KEY,
  role_id UUID NOT NULL,
  test_user_id UUID NOT NULL
) ON COMMIT DROP;

INSERT INTO test_builtin_roles (legacy_role, role_id, test_user_id) VALUES
  ('owner',                           'b0000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000101'),
  ('manager',                         'b0000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000102'),
  ('operations_manager',              'b0000000-0000-0000-0000-000000000003', '5a000000-0000-0000-0000-000000000103'),
  ('chef',                            'b0000000-0000-0000-0000-000000000004', '5a000000-0000-0000-0000-000000000104'),
  ('staff',                           'b0000000-0000-0000-0000-000000000005', '5a000000-0000-0000-0000-000000000105'),
  ('kiosk',                           'b0000000-0000-0000-0000-000000000006', '5a000000-0000-0000-0000-000000000106'),
  ('collaborator_accountant',         'b0000000-0000-0000-0000-000000000007', '5a000000-0000-0000-0000-000000000107'),
  ('collaborator_inventory',          'b0000000-0000-0000-0000-000000000008', '5a000000-0000-0000-0000-000000000108'),
  ('collaborator_chef',               'b0000000-0000-0000-0000-000000000009', '5a000000-0000-0000-0000-000000000109'),
  ('collaborator_operations_manager', 'b0000000-0000-0000-0000-00000000000a', '5a000000-0000-0000-0000-00000000010a');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
SELECT test_user_id, '5a000000-0000-0000-0000-000000000099', legacy_role, role_id
FROM test_builtin_roles
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

-- ----------------------------------------------------------------------------
-- Capability universe: the 57 legacy capabilities (matching the fixture's 57
-- WHEN branches above) + the 3 new sensitive flags (no legacy equivalent —
-- both the fixture's ELSE FALSE and the real function's empty role_flags
-- seed should deny them for every builtin) + one unrecognized capability as
-- a fail-closed sanity check. 61 rows.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE test_capabilities (capability TEXT PRIMARY KEY) ON COMMIT DROP;

INSERT INTO test_capabilities (capability) VALUES
  ('view:ai_assistant'), ('view:financial_intelligence'), ('view:dashboard'),
  ('view:transactions'), ('edit:transactions'), ('view:banking'), ('edit:banking'),
  ('view:expenses'), ('edit:expenses'), ('view:financial_statements'),
  ('view:chart_of_accounts'), ('edit:chart_of_accounts'), ('view:invoices'),
  ('edit:invoices'), ('view:customers'), ('edit:customers'),
  ('view:pending_outflows'), ('edit:pending_outflows'), ('view:assets'), ('edit:assets'),
  ('view:inventory'), ('edit:inventory'), ('view:inventory_audit'), ('edit:inventory_audit'),
  ('view:purchase_orders'), ('edit:purchase_orders'), ('view:receipt_import'),
  ('edit:receipt_import'), ('view:reports'), ('view:inventory_transactions'),
  ('edit:inventory_transactions'), ('view:recipes'), ('edit:recipes'),
  ('view:prep_recipes'), ('edit:prep_recipes'), ('view:batches'), ('edit:batches'),
  ('view:pos_sales'), ('view:scheduling'), ('edit:scheduling'), ('view:payroll'),
  ('edit:payroll'), ('view:tips'), ('edit:tips'), ('view:time_punches'), ('edit:time_punches'),
  ('view:team'), ('manage:team'), ('view:employees'), ('manage:employees'),
  ('view:settings'), ('edit:settings'), ('view:integrations'), ('manage:integrations'),
  ('view:collaborators'), ('manage:collaborators'), ('manage:subscription'),
  ('view:costs'), ('view:pay_rates'), ('view:employee_pii'),
  ('nonexistent:capability');

-- ----------------------------------------------------------------------------
-- Expected results, from the fixture (independent of the function under
-- test).
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE test_expected_results AS
SELECT b.legacy_role, b.role_id, c.capability,
       pg_temp.legacy_user_has_capability(b.legacy_role, c.capability, '5a000000-0000-0000-0000-000000000099'::uuid) AS expected
FROM test_builtin_roles b CROSS JOIN test_capabilities c;

-- ----------------------------------------------------------------------------
-- Actual results, from public.user_has_capability() (the function under
-- test), one auth context per builtin.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE test_actual_results (
  legacy_role TEXT,
  capability TEXT,
  actual BOOLEAN
) ON COMMIT DROP;

DO $$
DECLARE
  v_row RECORD;
  v_cap RECORD;
BEGIN
  FOR v_row IN SELECT * FROM test_builtin_roles LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_row.test_user_id::text, 'role', 'authenticated')::text,
      true);
    FOR v_cap IN SELECT capability FROM test_capabilities LOOP
      INSERT INTO test_actual_results (legacy_role, capability, actual)
      VALUES (
        v_row.legacy_role,
        v_cap.capability,
        public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, v_cap.capability)
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ============================================================================
-- 1. Byte-identical round trip (spot checks first — denied, then granted —
--    ahead of the full-matrix aggregate).
-- ============================================================================

-- Denied baseline: Kiosk holds zero areas, so a broadly-granted capability
-- must still be denied.
SELECT is(
  (SELECT actual FROM test_actual_results WHERE legacy_role = 'kiosk' AND capability = 'view:settings'),
  FALSE,
  'Kiosk (zero role_areas): view:settings denied — matches legacy CASE''s v_role NOT IN (''kiosk'')'
);

-- Granted: Owner holds every area at manage, so the same capability must be
-- granted.
SELECT is(
  (SELECT actual FROM test_actual_results WHERE legacy_role = 'owner' AND capability = 'view:settings'),
  TRUE,
  'Owner: view:settings granted via the settings area'
);

-- The one sanctioned exception, both directions, named explicitly.
SELECT is(
  (SELECT expected FROM test_expected_results WHERE legacy_role = 'collaborator_inventory' AND capability = 'view:reports'),
  TRUE,
  'legacy CASE fixture: collaborator_inventory held view:reports (line ~120 of 20260723120000)'
);
SELECT is(
  (SELECT actual FROM test_actual_results WHERE legacy_role = 'collaborator_inventory' AND capability = 'view:reports'),
  FALSE,
  'new area-based function: Inventory Helper denies view:reports — sanctioned drift from the legacy CASE per the design''s defect-3 resolution (follow TypeScript/ROLE_CAPABILITIES, PR #596); Task 2''s seed intentionally grants no reports area to this role'
);

-- The ten more sanctioned exceptions from the sensitive-data flags seed,
-- checked as one bag rather than twenty individual assertions.
CREATE TEMP TABLE test_sensitive_flag_exceptions (legacy_role TEXT, capability TEXT) ON COMMIT DROP;
INSERT INTO test_sensitive_flag_exceptions (legacy_role, capability) VALUES
  ('owner', 'view:pay_rates'), ('owner', 'view:employee_pii'),
  ('manager', 'view:pay_rates'), ('manager', 'view:employee_pii'),
  ('operations_manager', 'view:pay_rates'), ('operations_manager', 'view:employee_pii'),
  ('collaborator_accountant', 'view:pay_rates'), ('collaborator_accountant', 'view:employee_pii'),
  ('collaborator_operations_manager', 'view:pay_rates'), ('collaborator_operations_manager', 'view:employee_pii');

SELECT is(
  (
    SELECT count(*)::int FROM test_sensitive_flag_exceptions x
    JOIN test_expected_results e USING (legacy_role, capability)
    WHERE e.expected = FALSE
  ),
  10,
  'legacy CASE fixture: all ten (role, sensitive flag) pairs denied — both flags postdate the legacy CASE'
);
SELECT is(
  (
    SELECT count(*)::int FROM test_sensitive_flag_exceptions x
    JOIN test_actual_results a USING (legacy_role, capability)
    WHERE a.actual = TRUE
  ),
  10,
  'new area-based function: all ten (role, sensitive flag) pairs granted — 20260806100000_seed_employee_sensitive_flags.sql'
);

-- Full-matrix aggregate: every other cell (10 roles x 61 capabilities, minus
-- the eleven documented exceptions) must match exactly, in both directions.
SELECT is(
  (
    SELECT count(*)::int
    FROM test_actual_results a
    JOIN test_expected_results e USING (legacy_role, capability)
    LEFT JOIN test_sensitive_flag_exceptions x USING (legacy_role, capability)
    WHERE a.actual IS DISTINCT FROM e.expected
      AND NOT (a.legacy_role = 'collaborator_inventory' AND a.capability = 'view:reports')
      AND x.legacy_role IS NULL
  ),
  0,
  'user_has_capability(role_id-based) matches the legacy CASE byte-for-byte across all ten builtins x 61 capabilities, with exactly the eleven documented, sanctioned exceptions excluded above'
);

-- ============================================================================
-- 2. role_id IS NULL falls back to the legacy CASE (denied first, then
--    granted). A membership on 'chef' with role_id left NULL (as any
--    pre-Task-3 membership would be) must behave exactly like the legacy
--    function always did.
-- ============================================================================
INSERT INTO auth.users (id, email)
VALUES ('5a000000-0000-0000-0000-000000000201', 'task5-legacy-chef@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES ('5a000000-0000-0000-0000-000000000201', '5a000000-0000-0000-0000-000000000099', 'chef', NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'chef', role_id = NULL;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000201","role":"authenticated"}', true);

-- Denied first: legacy chef never held manage:team.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'manage:team'),
  FALSE,
  'role_id IS NULL fallback: legacy chef denied manage:team (never in the legacy CASE''s chef branches)'
);

-- Granted: legacy chef always held view:recipes.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:recipes'),
  TRUE,
  'role_id IS NULL fallback: legacy chef granted view:recipes (legacy CASE)'
);

-- ============================================================================
-- 2b. The two sensitive flags on a legacy membership.
--
-- create_restaurant_with_owner still writes (user_id, restaurant_id, role)
-- and leaves role_id NULL, so the owner of every restaurant created from now
-- on lands on the legacy path. The legacy CASE predates both flags and denies
-- them through its ELSE FALSE. Without the branch under test, the column gate
-- in 20260806110000 hides pay and contact data from that owner.
--
-- The five role strings below are the legacy equivalents of the five builtin
-- roles that 20260806100000 seeds, and they match view:employees exactly.
-- view:costs stays denied on both paths: no code reads it yet.
-- ============================================================================
INSERT INTO auth.users (id, email)
VALUES ('5a000000-0000-0000-0000-000000000202', 'task5-legacy-owner-flags@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES ('5a000000-0000-0000-0000-000000000202', '5a000000-0000-0000-0000-000000000099', 'owner', NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner', role_id = NULL;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000202","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:pay_rates'),
  TRUE,
  'role_id IS NULL: legacy owner holds view:pay_rates'
);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:employee_pii'),
  TRUE,
  'role_id IS NULL: legacy owner holds view:employee_pii'
);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:costs'),
  FALSE,
  'role_id IS NULL: legacy owner denied view:costs (no code reads it yet)'
);

-- The legacy chef holds view:employees on neither path, so it holds neither
-- flag. Same membership row as section 2.
SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000201","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:pay_rates'),
  FALSE,
  'role_id IS NULL: legacy chef denied view:pay_rates'
);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:employee_pii'),
  FALSE,
  'role_id IS NULL: legacy chef denied view:employee_pii'
);

-- ============================================================================
-- 3 & 4. Custom role {inventory: manage}, no role_flags initially.
--    3: gets edit:inventory, not edit:recipes (denied first, then granted).
--    4: gets edit:inventory but not view:costs until the flag is granted
--       (denied first); granting view:costs flips it without disturbing
--       edit:inventory.
-- ============================================================================
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '5a000000-0000-0000-0000-0000000000c1',
  '5a000000-0000-0000-0000-000000000099',
  'Task 5 Custom Inventory Role',
  'pgTAP fixture — custom role for the area/flag resolution test',
  'platform',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('5a000000-0000-0000-0000-0000000000c1', 'inventory', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = 'manage';

INSERT INTO auth.users (id, email)
VALUES ('5a000000-0000-0000-0000-000000000301', 'task5-custom-inv@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES (
  '5a000000-0000-0000-0000-000000000301',
  '5a000000-0000-0000-0000-000000000099',
  'collaborator_custom',
  '5a000000-0000-0000-0000-0000000000c1'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_custom', role_id = EXCLUDED.role_id;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000301","role":"authenticated"}', true);

-- 3. Denied first: recipes was never granted to this custom role.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:recipes'),
  FALSE,
  'custom role {inventory: manage}: edit:recipes denied (recipes area not granted)'
);
-- 3. Granted: inventory was granted at manage.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
  TRUE,
  'custom role {inventory: manage}: edit:inventory granted'
);

-- 4. Denied first: no view:costs role_flags row yet, even though the
--    inventory area is granted at manage.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:costs'),
  FALSE,
  'sensitive flag view:costs denied with no role_flags row, despite inventory:manage being granted'
);

-- Grant the flag.
INSERT INTO public.role_flags (role_id, flag)
VALUES ('5a000000-0000-0000-0000-0000000000c1', 'view:costs')
ON CONFLICT (role_id, flag) DO NOTHING;

-- 4. Granted: view:costs now TRUE via role_flags, independent of area level.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:costs'),
  TRUE,
  'sensitive flag view:costs granted once the role_flags row exists'
);
-- edit:inventory is unaffected by the flag addition.
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
  TRUE,
  'edit:inventory still granted after adding the view:costs flag (flags are additive, not gating, on the area check)'
);

-- ============================================================================
-- 4b. Membership is decided by "a row was found", not by "role is populated".
--
--     user_restaurants.role is nullable — it has always been
--     `role TEXT CHECK (...) DEFAULT 'staff'`, never NOT NULL — so a row
--     carrying only a role_id is a legal membership, and is precisely the
--     shape this branch moves toward. The original guard was
--     `IF v_role IS NULL THEN RETURN FALSE`, which read that row as "not a
--     member" and silently stripped every capability its areas grant. Three
--     assertions, because two different NULLs have to be told apart:
--     role NULL + role_id set is a member (grant), role NULL + role_id NULL
--     has nothing to resolve from (fail closed), and no row at all is a
--     non-member (fail closed).
-- ============================================================================
INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000302', 'task5-null-role-literal@example.com'),
  ('5a000000-0000-0000-0000-000000000303', 'task5-null-both@example.com'),
  ('5a000000-0000-0000-0000-000000000304', 'task5-non-member@example.com')
ON CONFLICT (id) DO NOTHING;

-- role_id points at the same {inventory: manage} custom role used above, so
-- the expected answer is already established by section 3.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES ('5a000000-0000-0000-0000-000000000302', '5a000000-0000-0000-0000-000000000099',
        NULL, '5a000000-0000-0000-0000-0000000000c1')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = NULL, role_id = EXCLUDED.role_id;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES ('5a000000-0000-0000-0000-000000000303', '5a000000-0000-0000-0000-000000000099', NULL, NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = NULL, role_id = NULL;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000303","role":"authenticated"}', true);

-- Denied baseline first: a membership with neither column set resolves from
-- nothing and must fail closed, so the grant below is not just "the function
-- returns TRUE for everyone".
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
  FALSE,
  'membership with role NULL and role_id NULL has nothing to resolve from — denied'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000304","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
  FALSE,
  'no user_restaurants row at all — a non-member is still denied'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000302","role":"authenticated"}', true);

SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:inventory'),
  TRUE,
  'membership with role NULL but role_id set still resolves its areas — role is nullable, so IS NULL is not a membership test'
);

-- Empty object rather than the JSON scalar `null`: both make auth.uid()
-- resolve to NULL for the inserts below, but `{}` is the shape every other
-- caller of set_config in these tests uses.
SELECT set_config('request.jwt.claims', '{}', true);

-- ============================================================================
-- 5. Re-pointed special-case coverage (Task 2 Step 8).
--
--    view:financial_intelligence and view:ai_assistant are hardcoded IF
--    branches above the generic VALUES map, each checking one specific
--    area_key at one specific level. Section 1's full-matrix round trip
--    exercises these only incidentally, through whatever areas the ten
--    builtins happen to hold; these five assertions target the branches
--    directly with custom roles built to isolate exactly what each one
--    checks. Reuses the shared pro/active restaurant from section 1's
--    header comment, so has_subscription_feature does not trivially deny.
-- ============================================================================
INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000501', 'task5-fi-granted@example.com'),
  ('5a000000-0000-0000-0000-000000000502', 'task5-fi-wrong-area@example.com'),
  ('5a000000-0000-0000-0000-000000000503', 'task5-ai-manage@example.com'),
  ('5a000000-0000-0000-0000-000000000504', 'task5-ai-view-only@example.com'),
  ('5a000000-0000-0000-0000-000000000505', 'task5-tips-granted@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('5a000000-0000-0000-0000-0000000000c2', '5a000000-0000-0000-0000-000000000099', 'Task 5 FI Granted Role', 'pgTAP fixture — financial_intelligence:view', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c3', '5a000000-0000-0000-0000-000000000099', 'Task 5 FI Wrong-Area Role', 'pgTAP fixture — transactions:view only', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c4', '5a000000-0000-0000-0000-000000000099', 'Task 5 AI Manage Role', 'pgTAP fixture — reports:manage', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c5', '5a000000-0000-0000-0000-000000000099', 'Task 5 AI View-Only Role', 'pgTAP fixture — reports:view only', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c6', '5a000000-0000-0000-0000-000000000099', 'Task 5 Tips Granted Role', 'pgTAP fixture — tips:view', 'platform', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('5a000000-0000-0000-0000-0000000000c2', 'financial_intelligence', 'view'),
  ('5a000000-0000-0000-0000-0000000000c3', 'transactions',           'view'),
  ('5a000000-0000-0000-0000-0000000000c4', 'reports',                'manage'),
  ('5a000000-0000-0000-0000-0000000000c5', 'reports',                'view'),
  ('5a000000-0000-0000-0000-0000000000c6', 'tips',                   'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('5a000000-0000-0000-0000-000000000501', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c2'),
  ('5a000000-0000-0000-0000-000000000502', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c3'),
  ('5a000000-0000-0000-0000-000000000503', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c4'),
  ('5a000000-0000-0000-0000-000000000504', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c5'),
  ('5a000000-0000-0000-0000-000000000505', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c6')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000501","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:financial_intelligence'),
  TRUE,
  're-pointed special case: view:financial_intelligence granted to a role holding financial_intelligence:view'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000502","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:financial_intelligence'),
  FALSE,
  're-pointed special case: view:financial_intelligence denied to a role holding only transactions:view — the branch checks the financial_intelligence area specifically, not the retired books bundle'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000503","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:ai_assistant'),
  TRUE,
  'view:ai_assistant still granted to a role holding reports:manage'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000504","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:ai_assistant'),
  FALSE,
  'view:ai_assistant still denied to a role holding only reports:view — the branch requires manage specifically'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000505","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:tips'),
  TRUE,
  'view:tips granted to a role holding tips:view — the tier that moved down to a plain area+level lookup in the Step 4 rewrite'
);

SELECT set_config('request.jwt.claims', '{}', true);

-- ============================================================================
-- 5b. view:pending_outflows / edit:pending_outflows resolve via an OR across
--    two areas ('print_checks' and 'expenses'), not a single-area VALUES
--    row. Expenses.tsx calls usePendingOutflows() unconditionally, so a
--    custom role granted Expenses without Print Checks must still satisfy
--    the pending_outflows RLS policies (20260120100100_update_rls_for_
--    collaborators.sql) — this is the fix for the P1 finding on
--    20260805120000_page_areas.sql: the migration's original design assumed
--    /print-checks was the only page reading that table.
-- ============================================================================
INSERT INTO auth.users (id, email) VALUES
  ('5a000000-0000-0000-0000-000000000601', 'task5-expenses-manage@example.com'),
  ('5a000000-0000-0000-0000-000000000602', 'task5-expenses-view-only@example.com'),
  ('5a000000-0000-0000-0000-000000000603', 'task5-neither-area@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('5a000000-0000-0000-0000-0000000000c7', '5a000000-0000-0000-0000-000000000099', 'Task 5 Expenses Manage Role', 'pgTAP fixture — expenses:manage, no print_checks', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c8', '5a000000-0000-0000-0000-000000000099', 'Task 5 Expenses View-Only Role', 'pgTAP fixture — expenses:view, no print_checks', 'platform', false),
  ('5a000000-0000-0000-0000-0000000000c9', '5a000000-0000-0000-0000-000000000099', 'Task 5 Neither Area Role', 'pgTAP fixture — transactions:manage only, no expenses/print_checks', 'platform', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('5a000000-0000-0000-0000-0000000000c7', 'expenses',     'manage'),
  ('5a000000-0000-0000-0000-0000000000c8', 'expenses',     'view'),
  ('5a000000-0000-0000-0000-0000000000c9', 'transactions', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id) VALUES
  ('5a000000-0000-0000-0000-000000000601', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c7'),
  ('5a000000-0000-0000-0000-000000000602', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c8'),
  ('5a000000-0000-0000-0000-000000000603', '5a000000-0000-0000-0000-000000000099', 'collaborator_custom', '5a000000-0000-0000-0000-0000000000c9')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000601","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:pending_outflows'),
  TRUE,
  'view:pending_outflows granted to a role holding expenses:manage with no print_checks area at all'
);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:pending_outflows'),
  TRUE,
  'edit:pending_outflows granted to a role holding expenses:manage with no print_checks area at all'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000602","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:pending_outflows'),
  TRUE,
  'view:pending_outflows granted to a role holding only expenses:view'
);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'edit:pending_outflows'),
  FALSE,
  'edit:pending_outflows denied to a role holding only expenses:view (manage required)'
);

SELECT set_config('request.jwt.claims', '{"sub":"5a000000-0000-0000-0000-000000000603","role":"authenticated"}', true);
SELECT is(
  public.user_has_capability('5a000000-0000-0000-0000-000000000099'::uuid, 'view:pending_outflows'),
  FALSE,
  'view:pending_outflows denied to a role holding neither expenses nor print_checks'
);

SELECT set_config('request.jwt.claims', '{}', true);

-- ============================================================================
-- 6. Performance gate.
-- ============================================================================

-- 50 products rows on the shared restaurant so a per-row RLS qual evaluation
-- (user_has_capability cannot be inlined — plpgsql + SECURITY DEFINER — so
-- Postgres calls it once per row scanned) has enough rows to make a
-- sequential scan or a missing index visible in the stats.
INSERT INTO public.products (restaurant_id, sku, name)
SELECT '5a000000-0000-0000-0000-000000000099', 'TASK5-SKU-' || gs, 'Task 5 Perf Product ' || gs
FROM generate_series(1, 50) AS gs
ON CONFLICT DO NOTHING;

-- Owner-flavored users for each path: role_id-NOT-NULL (area path, reuses
-- the Owner builtin user from the matrix above) and role_id-NULL (legacy
-- fallback path — a second owner-equivalent membership with role_id left
-- NULL, so both paths see identical products/RLS-capability outcome and
-- differ only in which branch of user_has_capability resolves it).
INSERT INTO auth.users (id, email)
VALUES ('5a000000-0000-0000-0000-000000000401', 'task5-legacy-owner@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES ('5a000000-0000-0000-0000-000000000401', '5a000000-0000-0000-0000-000000000099', 'owner', NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner', role_id = NULL;

-- Helper: run p_sql as the given user (switching to the 'authenticated' role
-- so RLS is actually enforced — as postgres/table-owner it would be
-- bypassed entirely) and return EXPLAIN ANALYZE's real execution time in ms.
CREATE OR REPLACE FUNCTION pg_temp.explain_exec_ms(p_user_id UUID, p_sql TEXT)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
DECLARE
  v_plan JSON;
  v_ms NUMERIC;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  EXECUTE 'EXPLAIN (ANALYZE, FORMAT JSON, TIMING TRUE) ' || p_sql INTO v_plan;
  v_ms := (v_plan->0->>'Execution Time')::numeric;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_ms;
END;
$$;

-- Index coverage for the lookups user_has_capability performs.
--
-- This deliberately does NOT use pg_stat_user_tables deltas. pgTAP runs the
-- whole file inside one transaction, and the cumulative statistics collector
-- does not surface in-transaction activity — it flushes at commit. Verified
-- directly: forcing both an index-eligible lookup and a full sequential scan
-- on role_areas inside a transaction leaves seq_scan and idx_scan deltas at
-- 0. So an "idx_scan increased" assertion can never pass here, and — worse —
-- a "seq_scan did not increase" assertion can never fail: it would report
-- success even if every call sequentially scanned the table. That is a
-- vacuous test of exactly the kind the [2026-07-13] denied-baseline lesson
-- warns about, so it is not worth keeping in a weakened form.
--
-- Nor is the planner's choice assertable at fixture scale: with ~66 role_areas
-- rows a sequential scan is genuinely cheaper, so EXPLAIN would legitimately
-- show one no matter how the function is written.
--
-- What IS a real, permanent guarantee is that the supporting indexes exist,
-- so the lookups stay index-eligible once production data arrives. Assert
-- that structurally; the execution-time ratio gate below covers the rest.
SELECT has_index(
  'public'::name, 'role_areas'::name, 'role_areas_pkey'::name,
  ARRAY['role_id', 'area_key']::name[],
  'role_areas_pkey indexes exactly (role_id, area_key), in that order'
);
SELECT col_is_pk(
  'public'::name, 'role_areas'::name, ARRAY['role_id', 'area_key']::name[],
  'role_areas PK is (role_id, area_key) — role_id leading, so the per-role lookup in user_has_capability is index-eligible'
);
SELECT col_is_pk(
  'public'::name, 'role_flags'::name, ARRAY['role_id', 'flag']::name[],
  'role_flags PK is (role_id, flag) — role_id leading, same rationale'
);

-- Execution-time ratio: area-based path vs. the role_id-NULL legacy
-- fallback, same restaurant/products, best-of-3 each to damp noise.
CREATE TEMP TABLE perf_timing (path TEXT, run INT, ms NUMERIC) ON COMMIT DROP;

DO $$
DECLARE i INT;
BEGIN
  FOR i IN 1..3 LOOP
    INSERT INTO perf_timing VALUES ('legacy', i, pg_temp.explain_exec_ms(
      '5a000000-0000-0000-0000-000000000401',
      'SELECT * FROM public.products WHERE restaurant_id = ''5a000000-0000-0000-0000-000000000099'''
    ));
    INSERT INTO perf_timing VALUES ('area', i, pg_temp.explain_exec_ms(
      '5a000000-0000-0000-0000-000000000101',
      'SELECT * FROM public.products WHERE restaurant_id = ''5a000000-0000-0000-0000-000000000099'''
    ));
  END LOOP;
END;
$$;

-- The floor is 10ms, not 1ms. The benchmark table is small enough that both
-- paths land well under a millisecond on a warm CI runner, where scheduler
-- noise alone swamps a 2x ratio — a 1ms floor turns "0.3ms vs 0.7ms", which
-- is nothing, into a red build. What this assertion is actually for is
-- catching a regression of a different order (a per-row function call, a lost
-- index), and that shows up far above 10ms.
SELECT ok(
  (SELECT min(ms) FROM perf_timing WHERE path = 'area')
    <= GREATEST((SELECT min(ms) FROM perf_timing WHERE path = 'legacy'), 10.0) * 2,
  'area-based path executes within 2x of the legacy-fallback path on products (best-of-3, 10ms floor to damp CI timing noise)'
);

SELECT * FROM finish();
ROLLBACK;
