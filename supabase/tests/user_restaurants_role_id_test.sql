-- ============================================================================
-- user_restaurants_role_id_test.sql
--
-- Task 3 of the "data-driven roles built from areas" design: pgTAP coverage
-- for `user_restaurants.role_id` (supabase/migrations/
-- 20260730120000_add_user_restaurants_role_id.sql). See
-- docs/superpowers/specs/2026-07-29-roles-and-areas-design.md and
-- docs/superpowers/plans/2026-07-29-roles-and-areas-plan.md, Task 3.
--
-- The column is nullable and additive: the legacy `role text` column keeps
-- its meaning and its CHECK constraint is untouched here (that is Task 4).
-- `role_id` is a second, parallel pointer at the seeded builtin row that
-- matches each membership's legacy `role` string.
--
-- Backfill is exercised via `public.backfill_user_restaurants_role_id()`,
-- the same idempotent (WHERE role_id IS NULL-guarded) function the migration
-- calls once for whatever memberships exist at deploy time. Calling it again
-- here against fixtures inserted in this transaction is what makes the
-- mapping testable and repeatable in CI, where `user_restaurants` starts
-- empty on every `db reset` — there is no seed data to backfill against.
--
-- The ten legacy role strings below are transcribed from the live
-- `user_restaurants_role_check` constraint
-- (supabase/migrations/20260723120000_add_collaborator_operations_manager_role.sql)
-- and paired one-for-one with the ten builtin ids seeded by
-- 20260730110000_seed_builtin_roles.sql — independently derived here rather
-- than read back from either migration, so the mapping is actually checked
-- rather than trivially reflected.
--
-- All fixture data (restaurant/user ids, emails) is fictional and exists
-- only for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(23);

-- ----------------------------------------------------------------------------
-- Fixtures: one restaurant, one user per legacy role, one membership row per
-- legacy role — role_id intentionally omitted (left NULL) on every insert.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'urrid-owner@example.test'),
  ('c0000000-0000-0000-0000-000000000002', 'urrid-manager@example.test'),
  ('c0000000-0000-0000-0000-000000000003', 'urrid-opsmgr@example.test'),
  ('c0000000-0000-0000-0000-000000000004', 'urrid-chef@example.test'),
  ('c0000000-0000-0000-0000-000000000005', 'urrid-staff@example.test'),
  ('c0000000-0000-0000-0000-000000000006', 'urrid-kiosk@example.test'),
  ('c0000000-0000-0000-0000-000000000007', 'urrid-collab-accountant@example.test'),
  ('c0000000-0000-0000-0000-000000000008', 'urrid-collab-inventory@example.test'),
  ('c0000000-0000-0000-0000-000000000009', 'urrid-collab-chef@example.test'),
  ('c0000000-0000-0000-0000-00000000000a', 'urrid-collab-opsmgr@example.test'),
  ('c0000000-0000-0000-0000-00000000000b', 'urrid-manual-owner@example.test'),
  ('c0000000-0000-0000-0000-00000000000c', 'urrid-nullable-role-id@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('c0000000-0000-0000-0000-0000000000f1', 'Role Id Backfill Test Restaurant');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('c0000000-0000-0000-0000-000000000101', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'owner'),
  ('c0000000-0000-0000-0000-000000000102', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-0000000000f1', 'manager'),
  ('c0000000-0000-0000-0000-000000000103', 'c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-0000000000f1', 'operations_manager'),
  ('c0000000-0000-0000-0000-000000000104', 'c0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-0000000000f1', 'chef'),
  ('c0000000-0000-0000-0000-000000000105', 'c0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-0000000000f1', 'staff'),
  ('c0000000-0000-0000-0000-000000000106', 'c0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-0000000000f1', 'kiosk'),
  ('c0000000-0000-0000-0000-000000000107', 'c0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-0000000000f1', 'collaborator_accountant'),
  ('c0000000-0000-0000-0000-000000000108', 'c0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-0000000000f1', 'collaborator_inventory'),
  ('c0000000-0000-0000-0000-000000000109', 'c0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-0000000000f1', 'collaborator_chef'),
  ('c0000000-0000-0000-0000-00000000010a', 'c0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-0000000000f1', 'collaborator_operations_manager');

-- ============================================================================
-- 1. Column exists, is uuid, and is nullable (additive — no NOT NULL).
-- ============================================================================
SELECT has_column(
  'public', 'user_restaurants', 'role_id',
  'user_restaurants.role_id exists'
);

SELECT col_type_is(
  'public', 'user_restaurants', 'role_id', 'uuid',
  'user_restaurants.role_id is uuid'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'collaborator_custom') $$,
  NULL, NULL,
  'the legacy role CHECK constraint still rejects collaborator_custom -- widening it is Task 4, not this one'
);

-- ============================================================================
-- 2. Denied baseline first: freshly inserted memberships have NULL role_id
--    before backfill runs (avoids a vacuous pass — [2026-07-13] lesson).
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.user_restaurants
     WHERE restaurant_id = 'c0000000-0000-0000-0000-0000000000f1' AND role_id IS NOT NULL),
  0,
  'before backfill, none of the ten fixture memberships have a role_id yet'
);

-- ============================================================================
-- 3. Backfill maps every legacy role string to its builtin role_id.
--    Expected ids transcribed independently from
--    20260730110000_seed_builtin_roles.sql, not read back from it.
-- ============================================================================
SELECT public.backfill_user_restaurants_role_id();

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000101'),
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'owner backfills to the Owner builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000102'),
  'b0000000-0000-0000-0000-000000000002'::uuid,
  'manager backfills to the Manager builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000103'),
  'b0000000-0000-0000-0000-000000000003'::uuid,
  'operations_manager backfills to the Operations Manager builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000104'),
  'b0000000-0000-0000-0000-000000000004'::uuid,
  'chef backfills to the Chef builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000105'),
  'b0000000-0000-0000-0000-000000000005'::uuid,
  'staff backfills to the Employee (self-service) builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000106'),
  'b0000000-0000-0000-0000-000000000006'::uuid,
  'kiosk backfills to the Kiosk builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000107'),
  'b0000000-0000-0000-0000-000000000007'::uuid,
  'collaborator_accountant backfills to the Accountant builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000108'),
  'b0000000-0000-0000-0000-000000000008'::uuid,
  'collaborator_inventory backfills to the Inventory Helper builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-000000000109'),
  'b0000000-0000-0000-0000-000000000009'::uuid,
  'collaborator_chef backfills to the Recipe Consultant builtin'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-00000000010a'),
  'b0000000-0000-0000-0000-00000000000a'::uuid,
  'collaborator_operations_manager backfills to the Operations Manager (Collaborator) builtin'
);

-- ============================================================================
-- 4. Backfill is idempotent and non-destructive: re-running it does not
--    error, and does not clobber a role_id that was already set explicitly
--    (even to a value that disagrees with the legacy-role mapping) — the
--    function only ever fills in NULLs.
-- ============================================================================
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('c0000000-0000-0000-0000-00000000010b', 'c0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-0000000000f1', 'owner', 'b0000000-0000-0000-0000-000000000002');

SELECT lives_ok(
  $$ SELECT public.backfill_user_restaurants_role_id() $$,
  'backfill function can be re-run without error'
);

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'c0000000-0000-0000-0000-00000000010b'),
  'b0000000-0000-0000-0000-000000000002'::uuid,
  'backfill does not overwrite a role_id that was already explicitly set'
);

-- ============================================================================
-- 5. The FK rejects a dangling id, on both INSERT and UPDATE.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id)
     VALUES ('c0000000-0000-0000-0000-0000000001ff', 'c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000f1', 'staff', 'ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  NULL, NULL,
  'inserting a role_id that does not exist in roles is rejected by the FK'
);

SELECT throws_ok(
  $$ UPDATE public.user_restaurants SET role_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'
     WHERE id = 'c0000000-0000-0000-0000-000000000101' $$,
  NULL, NULL,
  'updating role_id to a dangling id is rejected by the FK'
);

-- ============================================================================
-- 6. role_id genuinely stays nullable: a membership can be inserted with no
--    role_id at all (e.g. before any backfill has run for it).
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role)
     VALUES ('c0000000-0000-0000-0000-0000000001aa', 'c0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-0000000000f1', 'manager') $$,
  'a membership can be inserted with role_id left NULL'
);

-- ============================================================================
-- 7. The composite index on (user_id, restaurant_id, role_id) exists, so the
--    join `user_has_capability` will add in Task 5 has something to use.
-- ============================================================================
SELECT has_index(
  'public', 'user_restaurants', 'idx_user_restaurants_user_restaurant_role_id',
  ARRAY['user_id', 'restaurant_id', 'role_id'],
  'composite index on (user_id, restaurant_id, role_id) exists'
);

-- ============================================================================
-- 8. role_id is covered by the self-escalation guard, not just `role`.
--
--    user_has_capability() prefers role_id over the legacy role column, so a
--    guard that constrains only `role` leaves role_id as a silent parallel
--    channel to exactly the privileges it exists to deny: a staff member could
--    set role_id to the Owner builtin, leave role = 'staff' (which satisfies
--    the old allowlist), and the sync trigger would not intervene because
--    `role` never changed. Closed by
--    20260730180000_close_role_id_self_escalation.sql.
--
--    Run as the real `authenticated` role with JWT claims so RLS is actually
--    enforced — as superuser these policies do not apply at all.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c0000000-0000-0000-0000-000000000005","role":"authenticated"}';

SELECT throws_ok(
  $$ UPDATE public.user_restaurants
     SET role_id = 'b0000000-0000-0000-0000-000000000001'
     WHERE user_id = 'c0000000-0000-0000-0000-000000000005'
       AND restaurant_id = 'c0000000-0000-0000-0000-0000000000f1' $$,
  '42501',
  NULL,
  'a staff member cannot escalate by writing role_id alone (leaving role = staff)'
);

-- Positive control: the guard is not a blanket denial — the staff member may
-- still land on the role_id that agrees with the role they already hold.
SELECT lives_ok(
  $$ UPDATE public.user_restaurants
     SET role_id = 'b0000000-0000-0000-0000-000000000005'
     WHERE user_id = 'c0000000-0000-0000-0000-000000000005'
       AND restaurant_id = 'c0000000-0000-0000-0000-0000000000f1' $$,
  'a staff member may set role_id to the staff builtin (guard is not a blanket denial)'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT is(
  (SELECT role_id FROM public.user_restaurants
   WHERE user_id = 'c0000000-0000-0000-0000-000000000005'
     AND restaurant_id = 'c0000000-0000-0000-0000-0000000000f1'),
  'b0000000-0000-0000-0000-000000000005'::uuid,
  'the rejected escalation left no trace — role_id is the staff builtin, not owner'
);

SELECT * FROM finish();
ROLLBACK;
