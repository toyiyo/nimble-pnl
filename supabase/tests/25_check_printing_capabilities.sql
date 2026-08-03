-- ============================================================================
-- 25_check_printing_capabilities.sql
--
-- Task 1 of the "check-printing capability gating" plan
-- (docs/superpowers/plans/2026-08-02-check-printing-capability-gating-plan.md).
-- RED test for the migration that converts `claim_check_numbers_for_account`
-- and the write/select policies on check_bank_accounts, check_settings, and
-- check_audit_log from the legacy `role IN ('owner','manager')` /
-- role-literal guard to `user_has_capability(..., 'edit:pending_outflows')`
-- (write) / `user_has_capability(..., 'view:pending_outflows')` (select),
-- which resolve to the `books` area at manage/view level respectively.
--
-- Modelled on collaborator_custom_rls_test.sql: denied-baseline-first
-- throughout, custom roles built from `roles` + `role_areas`, impersonation
-- via set_config('role','authenticated',true) + request.jwt.claims, and the
-- 'role' GUC is reset back to 'postgres' before finish() (this file's
-- analogue of that reference file's RESET ROLE).
--
-- Five principals:
--   - one custom-role user (role_id set), whose role_areas grants are
--     escalated in three stages across this file: {inventory: manage} only
--     (principal A) -> + {books: view} (principal B) -> {books: manage}
--     (principal C). Reusing one user across stages mirrors the
--     "escalate in place" pattern from collaborator_custom_rls_test.sql and
--     keeps the RLS coverage (5.3) and RPC coverage (5.1/5.2) pinned to the
--     exact same grant transitions.
--   - four legacy users (role_id IS NULL): owner, manager, staff,
--     collaborator_accountant (principals D1, D2, E, F).
--
-- Every RPC assertion goes through pg_temp.as_user_claim(), a helper that
-- NEVER lets an exception escape to the caller (it catches internally and
-- reports ok/start_number/err as columns) -- unlike pgTAP's lives_ok/
-- throws_ok, this is safe to materialize once via a temp table and inspect
-- from multiple is() calls, without a second invocation that would
-- double-claim / double-increment next_check_number.
--
-- Per the lesson "editing a migration then running test:db without a reset
-- tests the OLD migration state", this file is run against a freshly reset
-- database (npm run db:reset && npm run test:db) both before Task 2's
-- migration exists (expected RED, specifically on assertions C and F) and
-- after it lands (expected GREEN).
-- ============================================================================

BEGIN;

SELECT plan(22);

-- ----------------------------------------------------------------------------
-- Fixture: one restaurant, one check_bank_accounts row, five principals.
-- ----------------------------------------------------------------------------
INSERT INTO public.restaurants (id, name)
VALUES ('25000000-0000-0000-0000-000000000001', 'Task 1 Check Capability Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Custom role, starts with zero area grants (escalated below through
-- inventory-manage-only -> +books-view -> books-manage).
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '25000000-0000-0000-0000-0000000000a1',
  '25000000-0000-0000-0000-000000000001',
  'Task 1 Custom Role (books escalation)',
  'pgTAP fixture -- principals A/B/C, escalated in place',
  'collaborator',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES
  ('25000000-0000-0000-0000-000000000101', 'task1-custom@example.com'),
  ('25000000-0000-0000-0000-000000000102', 'task1-owner@example.com'),
  ('25000000-0000-0000-0000-000000000103', 'task1-manager@example.com'),
  ('25000000-0000-0000-0000-000000000104', 'task1-staff@example.com'),
  ('25000000-0000-0000-0000-000000000105', 'task1-accountant@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES
  ('25000000-0000-0000-0000-000000000101', '25000000-0000-0000-0000-000000000001', 'collaborator_custom', '25000000-0000-0000-0000-0000000000a1'),
  ('25000000-0000-0000-0000-000000000102', '25000000-0000-0000-0000-000000000001', 'owner', NULL),
  ('25000000-0000-0000-0000-000000000103', '25000000-0000-0000-0000-000000000001', 'manager', NULL),
  ('25000000-0000-0000-0000-000000000104', '25000000-0000-0000-0000-000000000001', 'staff', NULL),
  ('25000000-0000-0000-0000-000000000105', '25000000-0000-0000-0000-000000000001', 'collaborator_accountant', NULL)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role, role_id = EXCLUDED.role_id;

-- Start the custom role with {inventory: manage} only -- no books area at
-- all. Principal A's baseline.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('25000000-0000-0000-0000-0000000000a1', 'inventory', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- The check_bank_accounts row every RPC/RLS assertion below targets.
DELETE FROM public.check_bank_accounts WHERE id = '25000000-0000-0000-0000-000000000b01'::uuid;
INSERT INTO public.check_bank_accounts (id, restaurant_id, account_name, next_check_number)
VALUES ('25000000-0000-0000-0000-000000000b01', '25000000-0000-0000-0000-000000000001', 'Task 1 Fixture Account', 1001);

-- ----------------------------------------------------------------------------
-- Helpers (RLS-scoped-execution, same pattern as collaborator_custom_rls_test.sql).
-- ----------------------------------------------------------------------------

-- Runs claim_check_numbers_for_account as p_user_id and NEVER lets an
-- exception escape -- catches internally so the row can be safely
-- materialized into a temp table and inspected by multiple is() calls
-- without a second (double-claiming) invocation.
CREATE OR REPLACE FUNCTION pg_temp.as_user_claim(
  p_user_id UUID, p_account_id UUID, p_count INTEGER
)
RETURNS TABLE(ok BOOLEAN, start_number INTEGER, err TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_start INTEGER;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  BEGIN
    v_start := public.claim_check_numbers_for_account(p_account_id, p_count);
    ok := true;
    start_number := v_start;
    err := NULL;
  EXCEPTION WHEN OTHERS THEN
    ok := false;
    start_number := NULL;
    err := SQLERRM;
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN NEXT;
END;
$$;

-- Runs p_sql (a SELECT count(*) ... statement) as p_user_id and returns the
-- count. Denial under RLS is silent (0 rows filtered), so this never raises.
CREATE OR REPLACE FUNCTION pg_temp.as_user_count(p_user_id UUID, p_sql TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  EXECUTE p_sql INTO v_count;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_count;
END;
$$;

-- Runs p_sql (an UPDATE statement) as p_user_id and returns the number of
-- rows actually updated. A USING clause that excludes the target row
-- filters it out silently (0 rows, no error) -- the right helper for
-- check_settings, which has UNIQUE(restaurant_id) so a denial-as-INSERT
-- probe would collide with the fixture row instead of testing RLS.
CREATE OR REPLACE FUNCTION pg_temp.as_user_update_count(p_user_id UUID, p_sql TEXT)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
  v_count BIGINT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  EXECUTE p_sql;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_count;
END;
$$;

-- Runs p_sql (an INSERT whose denial is enforced via WITH CHECK, which
-- raises 42501/insufficient_privilege) as p_user_id and returns 'allowed'
-- or 'denied'.
CREATE OR REPLACE FUNCTION pg_temp.as_user_try(p_user_id UUID, p_sql TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_result TEXT;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  BEGIN
    EXECUTE p_sql;
    v_result := 'allowed';
  EXCEPTION WHEN insufficient_privilege THEN
    v_result := 'denied';
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_result;
END;
$$;

-- ============================================================================
-- 1. claim_check_numbers_for_account authorization (denied-baseline-first).
-- ============================================================================

-- A. custom role, {inventory: manage} only (no books) -> denied.
SELECT is(
  (SELECT err FROM pg_temp.as_user_claim(
    '25000000-0000-0000-0000-000000000101'::uuid,
    '25000000-0000-0000-0000-000000000b01'::uuid, 1)),
  'Unauthorized: insufficient permissions for this restaurant',
  'principal A (custom role, inventory manage only): claim_check_numbers_for_account denied'
);

-- Grant {books: view} to the custom role. Principal B's baseline.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('25000000-0000-0000-0000-0000000000a1', 'books', 'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- B. custom role, {books: view} -> denied. Proves the bar is manage, not
-- "has any books grant".
SELECT is(
  (SELECT err FROM pg_temp.as_user_claim(
    '25000000-0000-0000-0000-000000000101'::uuid,
    '25000000-0000-0000-0000-000000000b01'::uuid, 1)),
  'Unauthorized: insufficient permissions for this restaurant',
  'principal B (custom role, books view): claim_check_numbers_for_account denied'
);

-- Upgrade to {books: manage}. Principal C's baseline.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('25000000-0000-0000-0000-0000000000a1', 'books', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- C. custom role, {books: manage} -> succeeds, returns the correct start
-- number, and advances next_check_number by the claimed count. This is one
-- of the two genuinely RED pairs for Task 1 (the other is F). Claimed once
-- (count=5) and materialized so all three assertions read the same call.
CREATE TEMP TABLE task1_claim_c AS
SELECT * FROM pg_temp.as_user_claim(
  '25000000-0000-0000-0000-000000000101'::uuid,
  '25000000-0000-0000-0000-000000000b01'::uuid, 5);

SELECT is(
  (SELECT ok FROM task1_claim_c),
  true,
  'principal C (custom role, books manage): claim_check_numbers_for_account succeeds'
);
SELECT is(
  (SELECT start_number FROM task1_claim_c),
  1001,
  'principal C: claimed start number is the prior next_check_number (1001)'
);
SELECT is(
  (SELECT next_check_number FROM public.check_bank_accounts WHERE id = '25000000-0000-0000-0000-000000000b01'::uuid),
  1006,
  'principal C: next_check_number advanced by the claimed count (1001 + 5)'
);

-- D. legacy role_id IS NULL: owner, then manager -> both succeed (legacy
-- CASE branch, no regression). Each claims count=1 from wherever the
-- account's counter currently stands (1006 after principal C above).
CREATE TEMP TABLE task1_claim_d1 AS
SELECT * FROM pg_temp.as_user_claim(
  '25000000-0000-0000-0000-000000000102'::uuid,
  '25000000-0000-0000-0000-000000000b01'::uuid, 1);

SELECT is(
  (SELECT ok FROM task1_claim_d1),
  true,
  'principal D1 (legacy owner): claim_check_numbers_for_account succeeds'
);

CREATE TEMP TABLE task1_claim_d2 AS
SELECT * FROM pg_temp.as_user_claim(
  '25000000-0000-0000-0000-000000000103'::uuid,
  '25000000-0000-0000-0000-000000000b01'::uuid, 1);

SELECT is(
  (SELECT ok FROM task1_claim_d2),
  true,
  'principal D2 (legacy manager): claim_check_numbers_for_account succeeds'
);

-- E. legacy role_id IS NULL: staff -> denied. Regression detector for
-- user_has_capability() misresolving inside SECURITY DEFINER (design 6,
-- risk table): if it did, this would flip.
SELECT is(
  (SELECT err FROM pg_temp.as_user_claim(
    '25000000-0000-0000-0000-000000000104'::uuid,
    '25000000-0000-0000-0000-000000000b01'::uuid, 1)),
  'Unauthorized: insufficient permissions for this restaurant',
  'principal E (legacy staff): claim_check_numbers_for_account denied'
);

-- F. legacy role_id IS NULL: collaborator_accountant -> succeeds. The
-- assertion this whole task exists for.
CREATE TEMP TABLE task1_claim_f AS
SELECT * FROM pg_temp.as_user_claim(
  '25000000-0000-0000-0000-000000000105'::uuid,
  '25000000-0000-0000-0000-000000000b01'::uuid, 1);

SELECT is(
  (SELECT ok FROM task1_claim_f),
  true,
  'principal F (legacy collaborator_accountant): claim_check_numbers_for_account succeeds'
);

-- ============================================================================
-- 2. RLS coverage (design 5.3) for the three converted tables:
--    check_bank_accounts, check_settings, check_audit_log.
--    Reuses the same custom-role user at its three grant stages: at
--    {inventory: manage} only (principal A) it cannot SELECT any of the
--    three tables at all; at {books: view} (principal B) it can SELECT all
--    three but every write is denied (the tier-ordering invariant: SELECT
--    tier <= route tier, design 5.5); at {books: manage} (principal C)
--    writes succeed.
-- ============================================================================

INSERT INTO public.check_settings (id, restaurant_id, business_name)
VALUES ('25000000-0000-0000-0000-000000000c01', '25000000-0000-0000-0000-000000000001', 'Task 1 Fixture Business')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.check_audit_log (id, restaurant_id, check_number, payee_name, amount, issue_date, action)
VALUES ('25000000-0000-0000-0000-000000000d01', '25000000-0000-0000-0000-000000000001', 9001, 'Task 1 Fixture Payee', 100.00, CURRENT_DATE, 'printed')
ON CONFLICT (id) DO NOTHING;

-- Section 1 above escalated the shared custom role all the way to
-- {books: manage} (principal C). Re-run the same three-stage escalation
-- here so the RLS assertions below observe the same grant transitions their
-- labels (A/B/C) describe, rather than inheriting section 1's end state.
DELETE FROM public.role_areas
  WHERE role_id = '25000000-0000-0000-0000-0000000000a1' AND area_key = 'books';

-- A. custom role, {inventory: manage} only (no books) -> cannot SELECT any
-- of the three tables.
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_bank_accounts WHERE id = ''25000000-0000-0000-0000-000000000b01'''),
  0::bigint,
  'principal A: cannot SELECT check_bank_accounts'
);
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_settings WHERE id = ''25000000-0000-0000-0000-000000000c01'''),
  0::bigint,
  'principal A: cannot SELECT check_settings'
);
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_audit_log WHERE id = ''25000000-0000-0000-0000-000000000d01'''),
  0::bigint,
  'principal A: cannot SELECT check_audit_log'
);

-- Grant {books: view} to the custom role. Principal B's baseline.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('25000000-0000-0000-0000-0000000000a1', 'books', 'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- B. custom role, {books: view} -> can SELECT all three, but every write is
-- denied (books view is not books manage).
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_bank_accounts WHERE id = ''25000000-0000-0000-0000-000000000b01'''),
  1::bigint,
  'principal B (books view): can SELECT check_bank_accounts'
);
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_settings WHERE id = ''25000000-0000-0000-0000-000000000c01'''),
  1::bigint,
  'principal B (books view): can SELECT check_settings'
);
SELECT is(
  pg_temp.as_user_count('25000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.check_audit_log WHERE id = ''25000000-0000-0000-0000-000000000d01'''),
  1::bigint,
  'principal B (books view): can SELECT check_audit_log'
);

SELECT is(
  pg_temp.as_user_try('25000000-0000-0000-0000-000000000101'::uuid,
    $$INSERT INTO public.check_bank_accounts (restaurant_id, account_name)
      VALUES ('25000000-0000-0000-0000-000000000001', 'Task 1 Denied Write B')$$),
  'denied',
  'principal B (books view): cannot INSERT check_bank_accounts'
);
-- check_settings has UNIQUE(restaurant_id) -- a second row for this
-- restaurant would collide with the fixture row regardless of RLS, so this
-- probes denial via UPDATE + row count instead of INSERT (see
-- as_user_update_count's comment).
SELECT is(
  pg_temp.as_user_update_count('25000000-0000-0000-0000-000000000101'::uuid,
    $$UPDATE public.check_settings SET business_name = 'Task 1 Denied Write B'
      WHERE id = '25000000-0000-0000-0000-000000000c01'$$),
  0::bigint,
  'principal B (books view): cannot UPDATE check_settings'
);
SELECT is(
  pg_temp.as_user_try('25000000-0000-0000-0000-000000000101'::uuid,
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('25000000-0000-0000-0000-000000000001', 9002, 'Task 1 Denied Write B', 50.00, CURRENT_DATE, 'printed')$$),
  'denied',
  'principal B (books view): cannot INSERT check_audit_log'
);

-- Upgrade to {books: manage}. Principal C's baseline.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('25000000-0000-0000-0000-0000000000a1', 'books', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

-- C. custom role, {books: manage} -> writes succeed on all three.
SELECT is(
  pg_temp.as_user_try('25000000-0000-0000-0000-000000000101'::uuid,
    $$INSERT INTO public.check_bank_accounts (restaurant_id, account_name)
      VALUES ('25000000-0000-0000-0000-000000000001', 'Task 1 Allowed Write C')$$),
  'allowed',
  'principal C (books manage): can INSERT check_bank_accounts'
);
-- check_settings has UNIQUE(restaurant_id); use UPDATE + row count rather
-- than a second INSERT (see as_user_update_count's comment).
SELECT is(
  pg_temp.as_user_update_count('25000000-0000-0000-0000-000000000101'::uuid,
    $$UPDATE public.check_settings SET business_name = 'Task 1 Updated Business'
      WHERE id = '25000000-0000-0000-0000-000000000c01'$$),
  1::bigint,
  'principal C (books manage): can UPDATE check_settings'
);
SELECT is(
  pg_temp.as_user_try('25000000-0000-0000-0000-000000000101'::uuid,
    $$INSERT INTO public.check_audit_log (restaurant_id, check_number, payee_name, amount, issue_date, action)
      VALUES ('25000000-0000-0000-0000-000000000001', 9003, 'Task 1 Allowed Write C', 75.00, CURRENT_DATE, 'printed')$$),
  'allowed',
  'principal C (books manage): can INSERT check_audit_log'
);

-- ============================================================================
-- 3. Immutability: check_audit_log still has no UPDATE/DELETE policy.
-- ============================================================================
-- cmd IN (..., 'ALL') too: a FOR ALL policy would permit UPDATE/DELETE
-- without ever showing up as a literal 'UPDATE'/'DELETE' row otherwise
-- (CodeRabbit finding, Phase 7c).
SELECT is(
  (SELECT count(*)::int FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'check_audit_log' AND cmd IN ('UPDATE', 'DELETE', 'ALL')),
  0,
  'check_audit_log still has no UPDATE/DELETE/ALL policy (immutability preserved)'
);

-- ----------------------------------------------------------------------------
-- Reset the 'role' GUC back to superuser before finish() (this file's
-- analogue of collaborator_custom_rls_test.sql's RESET ROLE).
-- ----------------------------------------------------------------------------
SELECT set_config('role', 'postgres', true);

SELECT * FROM finish();
ROLLBACK;
