-- ============================================================================
-- collaborator_custom_rls_test.sql
--
-- Task 6 of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md). RED test for
-- the migration that rewrites the 47 role-literal policies (on the 20
-- collaborator-reachable tables outside the pre-existing capability funnel)
-- to call public.user_has_capability() instead of enumerating roles.
--
-- Before that migration exists, a `collaborator_custom` role can never match
-- any of the 224 role-literal policies (verified in the design doc: 0 of
-- them use negation/pattern-matching, all are positive `role = ANY(...)`
-- enumeration, so an unrecognized role string is denied everywhere). This
-- file locks in:
--
--  1. Denied-baseline-first throughout: every assertion pair below tests
--     denial before it tests access.
--  2/3. A custom role granted {inventory: view} can SELECT `products` (the
--     pre-existing capability-tier table for the inventory domain) in its
--     own restaurant and cannot UPDATE it. Granted {inventory: manage}, it
--     can UPDATE. (This pair already passes today — Task 5 already wired
--     custom-role resolution into user_has_capability, and `products` has
--     called it since 20260120100100. It stays here as a stable regression
--     guard on the view/manage boundary the new migration must preserve.)
--  4. A second custom role, granted {tips: manage} — the area `view:tips`/
--     `edit:tips` resolve through since the 2026-08-05 page-shaped re-cut
--     (docs/superpowers/specs/2026-08-05-permissions-menu-mirror-design.md)
--     split `tips` out of the old bundled `scheduling` area — must be
--     GRANTED on `tip_pool_settings` (a shape-2 table: role literal
--     {owner,manager,operations_manager,collaborator_operations_manager}, no
--     open-to-any-member SELECT policy to confound the result), now that
--     Task 6's migration (20260730150000) rewrote its policies to call
--     user_has_capability(). Originally written against a {scheduling:
--     manage} grant, back when `scheduling:manage` was the area `view:tips`/
--     `edit:tips` resolved through (pre-2026-08-05); updated to `{tips:
--     manage}` to track the re-cut area_catalog.
--  5. Fail-closed property, tested rather than trusted: the {inventory:
--     manage}-only custom role from (2/3) is denied on one representative
--     table from EACH of the ten role-set shapes catalogued in the design
--     doc (including the three shapes — 2, 7, 8 — that Task 6 converted).
--     The sample tables are chosen so their capability domain (`tips` for
--     the shape-2 table, `time_punches` for shape-8, `books` for shape-7)
--     never overlaps with the `inventory` grant this role holds, so the
--     denial is durable regardless of which migrations have landed.
--  6. Cross-tenant isolation: the same custom role, granted {inventory:
--     manage} and a member only of restaurant R1, sees nothing in R2.
--  7. The receipt_imports drift guard, from commit 94505ec5 (design doc
--     section "A fourth drift, deliberately not closed here:
--     receipt_imports"): Task 6 deliberately skips these three policies
--     rather than mapping them to `edit:receipt_import` (would silently
--     widen every Chef's access) or to a capability whose legacy role list
--     happens to match today (would misrepresent what the policy checks, a
--     landmine for the next reader). Assert they still carry role literals
--     and do not call user_has_capability, so a later "cleanup" cannot
--     quietly convert them and widen access without revisiting that
--     decision.
--  8. The residual-policy guard: no policy on any table Task 6 rewrote still
--     names a collaborator_* role. A DROP POLICY IF EXISTS whose name has
--     drifted is a silent no-op, and the CREATE that follows it succeeds
--     anyway, leaving the old literal policy permissively OR'd beside the new
--     capability one — a failure every other assertion here would pass.
--
-- All fixture rows (restaurants, auth.users, user_restaurants, roles,
-- role_areas, employees, and data rows) exist only for the duration of this
-- transaction (ROLLBACK).
-- ============================================================================

BEGIN;

SELECT plan(27);

-- ----------------------------------------------------------------------------
-- Fixture: two restaurants (R1 primary, R2 for cross-tenant isolation).
-- ----------------------------------------------------------------------------
INSERT INTO public.restaurants (id, name)
VALUES
  ('6a000000-0000-0000-0000-000000000001', 'Task 6 Test Restaurant R1'),
  ('6a000000-0000-0000-0000-000000000002', 'Task 6 Test Restaurant R2')
ON CONFLICT (id) DO NOTHING;

-- Role A: custom role in R1, starts with zero area grants (denied baseline),
-- then granted {inventory: view} then upgraded to {inventory: manage}. Used
-- for the products view/manage split (2/3) and the fail-closed sample (5).
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '6a000000-0000-0000-0000-0000000000a1',
  '6a000000-0000-0000-0000-000000000001',
  'Task 6 Custom Role A (inventory)',
  'pgTAP fixture — view/manage split + fail-closed sample',
  -- Collaborator-flavored, like every real custom role. A platform-flavored
  -- fixture would slip past role_areas_enforce_collaborator_cap, which only
  -- inspects collaborator rows, so a later edit granting a capped area would
  -- pass here and be unreachable in production.
  'collaborator',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('6a000000-0000-0000-0000-000000000101', 'task6-role-a@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES (
  '6a000000-0000-0000-0000-000000000101',
  '6a000000-0000-0000-0000-000000000001',
  'collaborator_custom',
  '6a000000-0000-0000-0000-0000000000a1'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_custom', role_id = EXCLUDED.role_id;

-- Role B: a second custom role in R1, granted {tips: manage} directly.
-- Kept separate from Role A so the tip_pool_settings assertions (4) are
-- never contaminated by the inventory grant used in the fail-closed sample.
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '6a000000-0000-0000-0000-0000000000b1',
  '6a000000-0000-0000-0000-000000000001',
  'Task 6 Custom Role B (tips)',
  'pgTAP fixture — tips capability-funnel regression guard',
  'collaborator',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('6a000000-0000-0000-0000-000000000102', 'task6-role-b@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role, role_id)
VALUES (
  '6a000000-0000-0000-0000-000000000102',
  '6a000000-0000-0000-0000-000000000001',
  'collaborator_custom',
  '6a000000-0000-0000-0000-0000000000b1'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'collaborator_custom', role_id = EXCLUDED.role_id;

-- One employee row per restaurant, needed only to satisfy FK constraints on
-- time_punches/employee_pins (shapes 8/10) — the tables' role-gated policies
-- check user_restaurants.role, not this employee's identity.
INSERT INTO public.employees (id, restaurant_id, name, position)
VALUES ('6a000000-0000-0000-0000-000000000e01', '6a000000-0000-0000-0000-000000000001', 'Task 6 Fixture Employee', 'Server')
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Generic RLS-scoped-execution helpers (same pattern as
-- receipt_duplicate_detection.test.sql: switch role+jwt claims, run, switch
-- back). Dynamic SQL so one helper covers every table below instead of a
-- bespoke function per table.
-- ----------------------------------------------------------------------------

-- Runs p_sql (expected to be a SELECT count(*) ... statement) as p_user_id
-- and returns the count.
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

-- Runs p_sql (expected to be an UPDATE statement) as p_user_id and returns
-- the number of rows actually updated. A USING clause that excludes the
-- target row filters it out silently (0 rows, no error) — this is the right
-- helper for policies where denial is silent.
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

-- Runs p_sql (an INSERT or UPDATE whose denial is enforced via WITH CHECK,
-- which raises 42501/insufficient_privilege rather than silently filtering)
-- as p_user_id and returns 'allowed' or 'denied'.
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
-- 2/3. products (inventory domain): view-vs-manage split, denied first.
-- ============================================================================
INSERT INTO public.products (id, restaurant_id, sku, name)
VALUES ('6a000000-0000-0000-0000-000000000d01', '6a000000-0000-0000-0000-000000000001', 'TASK6-SKU-1', 'Task 6 Fixture Product')
ON CONFLICT (id) DO NOTHING;

-- Denied baseline: Role A holds zero area grants.
SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.products WHERE id = ''6a000000-0000-0000-0000-000000000d01'''),
  0::bigint,
  'denied baseline: custom role with zero area grants cannot SELECT products'
);
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.products SET name = ''nope'' WHERE id = ''6a000000-0000-0000-0000-000000000d01'''),
  0::bigint,
  'denied baseline: custom role with zero area grants cannot UPDATE products'
);

-- Grant {inventory: view}.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('6a000000-0000-0000-0000-0000000000a1', 'inventory', 'view')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = 'view';

SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.products WHERE id = ''6a000000-0000-0000-0000-000000000d01'''),
  1::bigint,
  'custom role {inventory: view}: can SELECT products in its own restaurant'
);
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.products SET name = ''still nope'' WHERE id = ''6a000000-0000-0000-0000-000000000d01'''),
  0::bigint,
  'custom role {inventory: view}: cannot UPDATE products (view is not manage)'
);

-- Upgrade to {inventory: manage}. An earlier revision of this file did this as
-- DELETE + INSERT, on the belief that block_builtin_role_child_mutation()
-- returned OLD unconditionally and so made any UPDATE on a non-builtin role's
-- role_areas row a silent no-op. That is not what the trigger does: it returns
-- `CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END`
-- (20260730100000_roles_and_areas_tables.sql:451), and roles_schema_test.sql
-- asserts the UPDATE persists. A plain upsert is correct.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('6a000000-0000-0000-0000-0000000000a1', 'inventory', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.products SET name = ''updated by manage grant'' WHERE id = ''6a000000-0000-0000-0000-000000000d01'''),
  1::bigint,
  'custom role {inventory: manage}: can UPDATE products'
);

-- ============================================================================
-- 4. tip_pool_settings (shape 2, tips domain): Role B, denied first with
--    zero grants, then granted access via {tips: manage} — tip_pool_settings'
--    policies call user_has_capability(restaurant_id, 'view:tips'/'edit:tips'),
--    and those capabilities resolve through the `tips` area since the
--    2026-08-05 page-shaped re-cut.
-- ============================================================================
INSERT INTO public.tip_pool_settings (id, restaurant_id)
VALUES ('6a000000-0000-0000-0000-000000000701', '6a000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- Denied baseline: Role B holds zero area grants.
SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'SELECT count(*) FROM public.tip_pool_settings WHERE id = ''6a000000-0000-0000-0000-000000000701'''),
  0::bigint,
  'denied baseline: custom role with zero area grants cannot SELECT tip_pool_settings'
);
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'UPDATE public.tip_pool_settings SET pooling_model = ''full_pool'' WHERE id = ''6a000000-0000-0000-0000-000000000701'''),
  0::bigint,
  'denied baseline: custom role with zero area grants cannot UPDATE tip_pool_settings'
);

-- Grant {tips: manage} to Role B.
INSERT INTO public.role_areas (role_id, area_key, level)
VALUES ('6a000000-0000-0000-0000-0000000000b1', 'tips', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = 'manage';

SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'SELECT count(*) FROM public.tip_pool_settings WHERE id = ''6a000000-0000-0000-0000-000000000701'' AND restaurant_id = ''6a000000-0000-0000-0000-000000000001'''),
  1::bigint,
  'custom role {tips: manage} can SELECT tip_pool_settings'
);
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'UPDATE public.tip_pool_settings SET pooling_model = ''full_pool'' WHERE id = ''6a000000-0000-0000-0000-000000000701'' AND restaurant_id = ''6a000000-0000-0000-0000-000000000001'''),
  1::bigint,
  'custom role {tips: manage} can UPDATE tip_pool_settings'
);

-- Role B's tips grant must not leak into unrelated domains (inventory,
-- books) — fail-closed holds for the broader-grant role too.
SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'SELECT count(*) FROM public.products WHERE id = ''6a000000-0000-0000-0000-000000000d01'' AND restaurant_id = ''6a000000-0000-0000-0000-000000000001'''),
  0::bigint,
  'custom role {tips: manage} still cannot SELECT products (inventory domain, not granted)'
);

INSERT INTO public.assets (id, restaurant_id, name, category, purchase_date, purchase_cost, useful_life_months, unit_cost)
VALUES ('6a000000-0000-0000-0000-000000000a51', '6a000000-0000-0000-0000-000000000001', 'Task 6 Fixture Asset', 'equipment', '2026-01-01', 1000, 60, 1000)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000102'::uuid,
    'UPDATE public.assets SET notes = ''nope'' WHERE id = ''6a000000-0000-0000-0000-000000000a51'''),
  0::bigint,
  'custom role {tips: manage} still cannot UPDATE assets (books domain, not granted)'
);

-- ============================================================================
-- 5. Fail-closed sample: one representative table per role-set shape,
--    against Role A (holds only {inventory: manage} from section 2/3).
--    Durable across the RED->GREEN transition: none of these tables' future
--    capability domain is `inventory`, so denial holds whether or not Task 6
--    has run.
-- ============================================================================

-- Shape 1: {owner, manager} — auto_deduction_settings.
INSERT INTO public.auto_deduction_settings (id, restaurant_id)
VALUES ('6a000000-0000-0000-0000-000000000501', '6a000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.auto_deduction_settings SET enabled = false WHERE id = ''6a000000-0000-0000-0000-000000000501'''),
  0::bigint,
  'fail-closed shape {owner,manager}: auto_deduction_settings UPDATE denied'
);

-- Shape 2: {owner, manager, operations_manager, collaborator_operations_manager}
-- — tip_pool_settings, same row as section 4, but under Role A (inventory
-- only, no tips grant at all) so this holds permanently.
SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.tip_pool_settings WHERE id = ''6a000000-0000-0000-0000-000000000701'' AND restaurant_id = ''6a000000-0000-0000-0000-000000000001'''),
  0::bigint,
  'fail-closed shape {owner,manager,operations_manager,collaborator_operations_manager}: tip_pool_settings SELECT denied for a role holding no tips grant'
);

-- Shape 3: {owner, manager, chef} — daily_food_costs.
INSERT INTO public.daily_food_costs (id, restaurant_id, date)
VALUES ('6a000000-0000-0000-0000-000000000503', '6a000000-0000-0000-0000-000000000001', '2026-07-01')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.daily_food_costs SET source = ''manual'' WHERE id = ''6a000000-0000-0000-0000-000000000503'''),
  0::bigint,
  'fail-closed shape {owner,manager,chef}: daily_food_costs UPDATE denied'
);

-- Shape 4: {owner, manager, operations_manager} — overtime_rules.
INSERT INTO public.overtime_rules (id, restaurant_id)
VALUES ('6a000000-0000-0000-0000-000000000504', '6a000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.overtime_rules SET weekly_ot_multiplier = 2.00 WHERE id = ''6a000000-0000-0000-0000-000000000504'''),
  0::bigint,
  'fail-closed shape {owner,manager,operations_manager}: overtime_rules UPDATE denied'
);

-- Shape 5: {owner} — enterprise_settings.
INSERT INTO public.enterprise_settings (id, restaurant_id)
VALUES ('6a000000-0000-0000-0000-000000000505', '6a000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.enterprise_settings SET sso_enabled = true WHERE id = ''6a000000-0000-0000-0000-000000000505'''),
  0::bigint,
  'fail-closed shape {owner}: enterprise_settings UPDATE denied'
);

-- Shape 6: {owner, manager, chef, staff} — inventory_locations INSERT
-- (denial enforced via WITH CHECK, so it raises rather than filters silently).
SELECT is(
  pg_temp.as_user_try('6a000000-0000-0000-0000-000000000101'::uuid,
    'INSERT INTO public.inventory_locations (restaurant_id, name) VALUES (''6a000000-0000-0000-0000-000000000001'', ''Task 6 Fixture Location'')'),
  'denied',
  'fail-closed shape {owner,manager,chef,staff}: inventory_locations INSERT denied'
);

-- Shape 7: {owner, manager, collaborator_accountant} — assets, same row as
-- section 4 but under Role A (no books grant).
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.assets SET notes = ''nope'' WHERE id = ''6a000000-0000-0000-0000-000000000a51'''),
  0::bigint,
  'fail-closed shape {owner,manager,collaborator_accountant}: assets UPDATE denied'
);

-- Shape 8: {owner, manager, operations_manager, collaborator_operations_manager, kiosk}
-- — time_punches INSERT (WITH CHECK denial, raises).
SELECT is(
  pg_temp.as_user_try('6a000000-0000-0000-0000-000000000101'::uuid,
    'INSERT INTO public.time_punches (restaurant_id, employee_id, punch_type) VALUES (''6a000000-0000-0000-0000-000000000001'', ''6a000000-0000-0000-0000-000000000e01'', ''clock_in'')'),
  'denied',
  'fail-closed shape {owner,manager,operations_manager,collaborator_operations_manager,kiosk}: time_punches INSERT denied'
);

-- Shape 9: {staff, kiosk} — user_restaurants self-escalation prevention.
-- A custom role is not in {staff,kiosk} either, so it cannot use the
-- self-editor allowance to set its own role to anything, let alone escalate.
SELECT is(
  pg_temp.as_user_try('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.user_restaurants SET role = ''owner'' WHERE user_id = ''6a000000-0000-0000-0000-000000000101'' AND restaurant_id = ''6a000000-0000-0000-0000-000000000001'''),
  'denied',
  'fail-closed shape {staff,kiosk}: custom role cannot self-escalate its own user_restaurants.role'
);

-- Shape 10: {kiosk} — employee_pins (employee_pins_usage_updates policy).
INSERT INTO public.employee_pins (id, restaurant_id, employee_id, pin_hash)
VALUES ('6a000000-0000-0000-0000-000000000510', '6a000000-0000-0000-0000-000000000001', '6a000000-0000-0000-0000-000000000e01', 'hashed-pin')
ON CONFLICT (id) DO NOTHING;
SELECT is(
  pg_temp.as_user_update_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'UPDATE public.employee_pins SET last_used_at = now() WHERE id = ''6a000000-0000-0000-0000-000000000510'''),
  0::bigint,
  'fail-closed shape {kiosk}: employee_pins kiosk-only UPDATE denied'
);

-- ============================================================================
-- 6. Cross-tenant isolation: Role A (inventory: manage, member of R1 only)
--    sees nothing in R2, even though R2 has its own products row.
-- ============================================================================
INSERT INTO public.products (id, restaurant_id, sku, name)
VALUES ('6a000000-0000-0000-0000-000000000d02', '6a000000-0000-0000-0000-000000000002', 'TASK6-SKU-R2', 'R2 Fixture Product')
ON CONFLICT (id) DO NOTHING;

SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.products WHERE restaurant_id = ''6a000000-0000-0000-0000-000000000002'''),
  0::bigint,
  'cross-tenant isolation: custom role with {inventory: manage} in R1 sees zero products rows in R2'
);
SELECT is(
  pg_temp.as_user_count('6a000000-0000-0000-0000-000000000101'::uuid,
    'SELECT count(*) FROM public.products'),
  1::bigint,
  'cross-tenant isolation: custom role''s unfiltered products count is exactly R1''s one row, never R2''s'
);

-- ============================================================================
-- 7. receipt_imports drift guard (commit 94505ec5 / design doc "A fourth
--    drift, deliberately not closed here: receipt_imports"). Static metadata
--    check, no RLS session needed.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'receipt_imports'),
  3,
  'receipt_imports still carries exactly its three original policies'
);
SELECT is(
  (
    SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'receipt_imports'
      AND (coalesce(qual, '') ~ 'user_has_capability' OR coalesce(with_check, '') ~ 'user_has_capability')
  ),
  0,
  'receipt_imports policies do not call user_has_capability — deliberately left on role literals so a later cleanup cannot quietly widen Chef''s access'
);
SELECT is(
  (
    SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'receipt_imports'
      AND (coalesce(qual, '') ~ 'role = ANY' OR coalesce(with_check, '') ~ 'role = ANY')
  ),
  3,
  'all three receipt_imports policies still match against a role literal array'
);

-- ============================================================================
-- No residual collaborator-literal policy survives on a rewritten table.
--
-- 20260730150000 rewrites each policy as DROP POLICY IF EXISTS "<name>" then
-- CREATE POLICY "<name>". If the name in the DROP does not match the name the
-- policy actually has -- a typo, or a rename in a migration that landed
-- between the audit and this one -- the DROP is a silent no-op and the CREATE
-- succeeds anyway, because it uses the same name the DROP failed to find. The
-- result is the new capability policy sitting BESIDE the old literal one.
--
-- That failure is invisible to every other assertion in this file. Permissive
-- policies OR together, so the stale policy keeps granting exactly what it
-- always granted: the custom-role cases below still pass, the legacy roles
-- still work, and nothing looks wrong until someone edits a role's areas and
-- finds the revocation has no effect for a collaborator_* member.
--
-- So this scans the rewritten tables directly. receipt_imports is excluded by
-- name because its literals are deliberate (see the block above); time_punches
-- is included because its kept literal is `role = 'kiosk'`, not a
-- collaborator_* one. The failure message names the offending policies rather
-- than just counting them, since "which one drifted" is the whole question.
-- ============================================================================
SELECT is(
  (
    SELECT coalesce(string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname), '')
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY (ARRAY[
        'asset_depreciation_schedule', 'asset_photos', 'assets',
        'open_shift_claims', 'schedule_change_logs', 'schedule_publications',
        'shift_templates', 'shifts', 'staffing_settings', 'time_off_requests',
        'time_punches', 'tip_contribution_pools', 'tip_disputes', 'tip_payouts',
        'tip_pool_allocations', 'tip_pool_settings', 'tip_server_earnings',
        'tip_split_items', 'tip_splits'
      ])
      AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          ~ 'collaborator_(accountant|inventory|chef|operations_manager)'
  ),
  '',
  'no policy on a rewritten table still names a collaborator_* role — a drifted DROP would leave the old policy beside the new one'
);

SELECT * FROM finish();
ROLLBACK;
