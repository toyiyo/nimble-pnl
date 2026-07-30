-- ============================================================================
-- roles_schema_test.sql
--
-- Task 1 of the "data-driven roles built from areas" design: pgTAP coverage
-- for the roles / role_areas / role_flags / area_catalog schema and its
-- triggers (builtin immutability, builtin-name-collision guard, collaborator
-- area cap). See docs/superpowers/specs/2026-07-29-roles-and-areas-design.md
-- and docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md.
--
-- All fixture data below (restaurant names, user emails, role names) is
-- fictional and exists only for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(37);

-- ----------------------------------------------------------------------------
-- Fixtures: two fictional restaurants (A, B, both owned by the same owner —
-- needed for the cross-restaurant name-uniqueness test), four principals, one
-- seeded builtin role with a child row in each of role_areas/role_flags (to
-- test child-table immutability), and one custom collaborator-flavored role.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'roles-test-owner@example.test'),
  ('a0000000-0000-0000-0000-000000000002', 'roles-test-manager@example.test'),
  ('a0000000-0000-0000-0000-000000000003', 'roles-test-staff@example.test'),
  ('a0000000-0000-0000-0000-000000000004', 'roles-test-nonmember@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'Roles Schema Test Restaurant A'),
  ('a0000000-0000-0000-0000-0000000000a2', 'Roles Schema Test Restaurant B');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1', 'owner'),
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a2', 'owner'),
  ('a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a1', 'manager'),
  ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-0000000000a1', 'staff');

-- A builtin ("global") role, seeded as postgres, with children in both
-- role_areas and role_flags — used to test builtin/child immutability. Named
-- distinctly from any of the ten real builtins seeded by
-- 20260730110000_seed_builtin_roles.sql (Owner, Manager, Operations Manager,
-- Chef, Employee (self-service), Kiosk, Accountant, Inventory Helper, Recipe
-- Consultant, Operations Manager (Collaborator)) so this fixture doesn't
-- collide with uq_roles_global_name_ci against the now-seeded rows. Test 10
-- below (the collision-guard test) deliberately targets the real "Owner"
-- builtin instead, which is a more faithful test now that it exists.
INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('a0000000-0000-0000-0000-0000000000b1', NULL, 'QA Fixture Role', 'platform', true);

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('a0000000-0000-0000-0000-0000000000b1', 'team', 'manage');

INSERT INTO public.role_flags (role_id, flag) VALUES
  ('a0000000-0000-0000-0000-0000000000b1', 'view:costs');

-- ============================================================================
-- 1. created_at is timestamptz, not timestamp (recent repo lesson: two
--    timezone off-by-one incidents came from getting this wrong on a new
--    table — c675d566, 34172f80).
-- ============================================================================
SELECT col_type_is(
  'public', 'roles', 'created_at', 'timestamp with time zone',
  'roles.created_at is timestamptz'
);

-- ============================================================================
-- 2. Owner (holds manage:collaborators) can INSERT a custom role into their
--    own restaurant.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000a1', 'Front Desk Lead', 'collaborator', false) $$,
  'owner (manage:collaborators holder) can insert a custom role into their own restaurant'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 3. Denied-baseline-first: a non-member sees 0 rows for restaurant A's
--    custom role before asserting the owner can see it (avoids a vacuous
--    pass from an empty result set — [2026-07-13] lesson).
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE id = 'a0000000-0000-0000-0000-0000000000c1'),
  0,
  'non-member sees 0 rows for restaurant A''s custom role (denied baseline)'
);

RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE id = 'a0000000-0000-0000-0000-0000000000c1'),
  1,
  'owner (member of restaurant A) can see the custom role they created'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 4. staff (lacks manage:collaborators) cannot INSERT a role.
--    Note: the plan text says "a manager without manage:collaborators", but
--    the live user_has_capability (20260723120000) grants manage:collaborators
--    to BOTH owner and manager today — this task does not touch that
--    function. staff is the correct fixture for "lacks manage:collaborators"
--    while preserving the design's actual invariant.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-0000000000a1', 'Should Not Exist', 'collaborator', false) $$,
  NULL, NULL,
  'staff (lacks manage:collaborators) cannot insert a role'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 5. Global builtins are readable by any member (tested via manager, who did
--    not create the builtin fixture).
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE id = 'a0000000-0000-0000-0000-0000000000b1'),
  1,
  'a global builtin role is readable by any authenticated member'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 6. role_areas / role_flags inherit the parent role's tenant scope: owner
--    can insert grants on their own custom role; denied-baseline-first for a
--    non-member, then confirm the owner can read what they inserted.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'reports', 'view') $$,
  'owner can insert a role_areas grant on their own custom role'
);

SELECT lives_ok(
  $$ INSERT INTO public.role_flags (role_id, flag)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'view:costs') $$,
  'owner can insert a role_flags grant on their own custom role'
);

RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.role_areas WHERE role_id = 'a0000000-0000-0000-0000-0000000000c1'),
  0,
  'non-member sees 0 role_areas rows for restaurant A''s custom role (denied baseline)'
);

SELECT is(
  (SELECT count(*)::int FROM public.role_flags WHERE role_id = 'a0000000-0000-0000-0000-0000000000c1'),
  0,
  'non-member sees 0 role_flags rows for restaurant A''s custom role (denied baseline)'
);

RESET ROLE;
RESET request.jwt.claims;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.role_areas WHERE role_id = 'a0000000-0000-0000-0000-0000000000c1'),
  1,
  'owner (member of restaurant A) can see the role_areas grant they created'
);

SELECT is(
  (SELECT count(*)::int FROM public.role_flags WHERE role_id = 'a0000000-0000-0000-0000-0000000000c1'),
  1,
  'owner (member of restaurant A) can see the role_flags grant they created'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 7. role_areas.level CHECK constraint rejects a value outside ('view','manage').
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'sales', 'admin') $$,
  NULL, NULL,
  'role_areas.level rejects a value outside (view, manage)'
);

-- ============================================================================
-- 8. Builtin roles table immutability survives RLS being off: run as the
--    superuser (postgres, which has BYPASSRLS) with row_security explicitly
--    disabled, to prove the trigger — not RLS — is what blocks the write.
-- ============================================================================
SET LOCAL row_security = off;

SELECT throws_ok(
  $$ UPDATE public.roles SET name = 'Renamed' WHERE id = 'a0000000-0000-0000-0000-0000000000b1' $$,
  NULL, NULL,
  'builtin role UPDATE is rejected even with RLS off (superuser)'
);

SELECT throws_ok(
  $$ DELETE FROM public.roles WHERE id = 'a0000000-0000-0000-0000-0000000000b1' $$,
  NULL, NULL,
  'builtin role DELETE is rejected even with RLS off (superuser)'
);

-- ============================================================================
-- 9. Same invariant for the builtin's children in role_areas and role_flags.
-- ============================================================================
SELECT throws_ok(
  $$ UPDATE public.role_areas SET level = 'view' WHERE role_id = 'a0000000-0000-0000-0000-0000000000b1' AND area_key = 'team' $$,
  NULL, NULL,
  'role_areas row for a builtin role rejects UPDATE even with RLS off'
);

SELECT throws_ok(
  $$ DELETE FROM public.role_areas WHERE role_id = 'a0000000-0000-0000-0000-0000000000b1' AND area_key = 'team' $$,
  NULL, NULL,
  'role_areas row for a builtin role rejects DELETE even with RLS off'
);

SELECT throws_ok(
  $$ UPDATE public.role_flags SET flag = 'view:pay_rates' WHERE role_id = 'a0000000-0000-0000-0000-0000000000b1' AND flag = 'view:costs' $$,
  NULL, NULL,
  'role_flags row for a builtin role rejects UPDATE even with RLS off'
);

SELECT throws_ok(
  $$ DELETE FROM public.role_flags WHERE role_id = 'a0000000-0000-0000-0000-0000000000b1' AND flag = 'view:costs' $$,
  NULL, NULL,
  'role_flags row for a builtin role rejects DELETE even with RLS off'
);

RESET row_security;

-- ============================================================================
-- 10. Builtin-name-collision guard: a custom role cannot be named (case-
--     insensitively) after the "Owner" builtin. Two casings tested.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c3', 'a0000000-0000-0000-0000-0000000000a1', 'Owner', 'collaborator', false) $$,
  NULL, NULL,
  'a custom role cannot be named "Owner" (exact-case collision with builtin)'
);

SELECT throws_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c4', 'a0000000-0000-0000-0000-0000000000a1', 'oWnEr', 'collaborator', false) $$,
  NULL, NULL,
  'a custom role cannot be named "oWnEr" (case-insensitive collision with builtin)'
);

-- ============================================================================
-- 11. Name uniqueness: duplicate name within the same restaurant fails;
--     the same name in a different restaurant succeeds.
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c5', 'a0000000-0000-0000-0000-0000000000a1', 'Shift Lead', 'collaborator', false) $$,
  'first "Shift Lead" role in restaurant A succeeds'
);

SELECT throws_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c6', 'a0000000-0000-0000-0000-0000000000a1', 'shift lead', 'collaborator', false) $$,
  NULL, NULL,
  'a second "shift lead" role in the same restaurant (case-insensitive) fails'
);

SELECT lives_ok(
  $$ INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin)
     VALUES ('a0000000-0000-0000-0000-0000000000c7', 'a0000000-0000-0000-0000-0000000000a2', 'Shift Lead', 'collaborator', false) $$,
  'the same name "Shift Lead" in a different restaurant (B) succeeds'
);

-- ============================================================================
-- 12. Per-area collaborator cap enforced on the custom collaborator-flavored
--     role (fixture c1): reports/sales/payroll/settings cap at 'view', team
--     is ungrantable at any level. Sanity check: the builtin owner role
--     legitimately holds team=manage (already seeded above, unaffected by
--     the cap since builtin roles are exempt).
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'sales', 'manage') $$,
  NULL, NULL,
  'collaborator role cannot be granted sales at manage (capped at view)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'reports', 'manage') $$,
  NULL, NULL,
  'collaborator role cannot be granted reports at manage (capped at view)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'payroll', 'manage') $$,
  NULL, NULL,
  'collaborator role cannot be granted payroll at manage (capped at view)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'settings', 'manage') $$,
  NULL, NULL,
  'collaborator role cannot be granted settings at manage (capped at view)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'team', 'view') $$,
  NULL, NULL,
  'collaborator role cannot be granted team at view (ungrantable)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'team', 'manage') $$,
  NULL, NULL,
  'collaborator role cannot be granted team at manage (ungrantable)'
);

SELECT ok(
  (SELECT true FROM public.role_areas WHERE role_id = 'a0000000-0000-0000-0000-0000000000b1' AND area_key = 'team' AND level = 'manage'),
  'sanity check: the builtin fixture role legitimately holds team=manage (builtin exempt from the cap)'
);

-- ============================================================================
-- 13. The cap guard survives RLS being off too (superuser, row_security off)
--     — same rationale as item 8: proves the trigger, not RLS, is the actual
--     enforcement mechanism.
-- ============================================================================
SET LOCAL row_security = off;

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'team', 'manage') $$,
  NULL, NULL,
  'cap guard rejects team=manage for a collaborator role even with RLS off (superuser)'
);

SELECT throws_ok(
  $$ INSERT INTO public.role_areas (role_id, area_key, level)
     VALUES ('a0000000-0000-0000-0000-0000000000c1', 'reports', 'manage') $$,
  NULL, NULL,
  'cap guard rejects reports=manage for a collaborator role even with RLS off (superuser)'
);

RESET row_security;

-- ============================================================================
-- 14. area_catalog shape: fourteen areas collapsing onto the ten ui_groups of
--     the approved design. The four splits (purchasing, chart_of_accounts,
--     collaborators, integrations) exist so the builtin roles derive
--     byte-identically from ROLE_CAPABILITIES; see the migration's column
--     comment.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.area_catalog),
  14,
  'area_catalog holds fourteen areas'
);

SELECT is(
  (SELECT count(DISTINCT ui_group)::int FROM public.area_catalog),
  10,
  'the fourteen areas collapse onto the ten ui_groups of the approved design'
);

-- The editor renders one level control per ui_group and writes every area_key
-- in that group. If two areas in a group disagreed on max_level_collaborator,
-- that single control would offer a level the cap trigger then rejects for
-- half the group — a write that half-applies. Keep the caps aligned.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT ui_group
     FROM public.area_catalog
     GROUP BY ui_group
     HAVING count(DISTINCT max_level_collaborator) > 1
        OR (count(*) FILTER (WHERE max_level_collaborator IS NULL) NOT IN (0, count(*)))
   ) AS mixed),
  0,
  'every ui_group has one max_level_collaborator across all its areas'
);

-- Same argument for band and sort_order: the group is one row in one band at
-- one position, so its members cannot disagree about where it renders.
SELECT is(
  (SELECT count(*)::int FROM (
     SELECT ui_group
     FROM public.area_catalog
     GROUP BY ui_group
     HAVING count(DISTINCT band) > 1 OR count(DISTINCT sort_order) > 1
   ) AS mixed),
  0,
  'every ui_group renders in one band at one sort_order'
);

SELECT * FROM finish();

ROLLBACK;
