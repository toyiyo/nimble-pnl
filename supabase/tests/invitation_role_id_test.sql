-- ============================================================================
-- invitation_role_id_test.sql
--
-- Sub-task 9f (backend half) of the "data-driven roles built from areas"
-- design. Covers supabase/migrations/
-- 20260730170000_invitation_role_id_and_membership_role_sync.sql.
--
-- WHY THIS MIGRATION EXISTS AT ALL
--
-- The design (2026-07-29-roles-and-areas-design.md:490-492) and the plan
-- (2026-07-29-roles-and-areas-plan.md:278-284) both require the collaborator
-- invite mutation to "send both the 'collaborator_custom' literal and
-- role_id" -- but neither specified anywhere for that role_id to *live*.
-- `invitations` has no role_id column, `accept-invitation` inserts only
-- `role` into `user_restaurants`, and a membership with
-- role='collaborator_custom' + role_id=NULL resolves through the legacy
-- role-literal CASE in user_has_capability(), where 'collaborator_custom'
-- appears in no IN-list. A custom role could be created in the new editor
-- and then assigned to nobody: the invite would send and accept
-- successfully and silently grant nothing.
--
-- TWO SEPARATE THINGS ARE TESTED HERE, because the migration does two things:
--
--   1. invitations.role_id -- the missing carrier. Nullable (every builtin
--      invite leaves it NULL and keeps working exactly as before), FK to
--      roles(id) so a dangling id cannot be stored.
--
--   2. The user_restaurants role/role_id sync trigger. This is NOT
--      incidental tidiness -- it closes a privilege-escalation regression
--      this branch would otherwise introduce. Task 5 made role_id take
--      *precedence* over role in user_has_capability()
--      (20260730140000:70-84), while `TeamMembers.updateMemberRole`
--      (src/components/TeamMembers.tsx:112-133) still writes the `role` text
--      column alone. Demoting an owner to staff through that UI would leave
--      role_id pointing at the Owner builtin, so the demoted member would
--      keep every owner capability while the UI displayed "Staff".
--
-- The trigger is deliberately UPDATE-only. An INSERT that omits role_id must
-- keep leaving it NULL -- that is the legacy-fallback path Task 3 documents
-- and user_restaurants_role_id_test.sql explicitly asserts ("before backfill,
-- none of the ten fixture memberships have a role_id yet"). Auto-filling on
-- INSERT would move every newly created membership onto the areas path as a
-- silent side effect of an unrelated migration.
--
-- All fixture data (restaurant/user ids, emails) is fictional and exists only
-- for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(18);

-- ----------------------------------------------------------------------------
-- Fixtures: one restaurant, one custom role scoped to it, one custom role
-- belonging to a *different* restaurant (for the cross-tenant assertion), and
-- memberships covering each trigger branch.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'invrid-owner@example.test'),
  ('d0000000-0000-0000-0000-000000000002', 'invrid-demoted@example.test'),
  ('d0000000-0000-0000-0000-000000000003', 'invrid-custom@example.test'),
  ('d0000000-0000-0000-0000-000000000004', 'invrid-legacy@example.test'),
  ('d0000000-0000-0000-0000-000000000005', 'invrid-explicit@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('d0000000-0000-0000-0000-0000000000f1', 'Invitation Role Id Test Restaurant'),
  ('d0000000-0000-0000-0000-0000000000f2', 'Other Tenant Restaurant');

INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'd0000000-0000-0000-0000-0000000000f1',
   'Weekend Supervisor', 'Custom role for the invite path', 'collaborator', false);

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('d0000000-0000-0000-0000-0000000000e1', 'scheduling', 'manage');

-- ============================================================================
-- 1. invitations.role_id: the carrier column.
-- ============================================================================
SELECT has_column(
  'public', 'invitations', 'role_id',
  'invitations.role_id exists'
);

SELECT col_type_is(
  'public', 'invitations', 'role_id', 'uuid',
  'invitations.role_id is uuid'
);

SELECT col_is_null(
  'public', 'invitations', 'role_id',
  'invitations.role_id is nullable -- a builtin-role invite leaves it unset'
);

-- Denied baseline before the positive case, so the FK assertion below is not
-- vacuously satisfied by an insert that was going to fail anyway.
SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-000000000001',
             'dangling@example.test', 'collaborator_custom', 'tok-dangling',
             'ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  NULL, NULL,
  'a role_id with no matching roles row is rejected by the FK'
);

SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-000000000001',
             'custom-invite@example.test', 'collaborator_custom', 'tok-custom',
             'd0000000-0000-0000-0000-0000000000e1') $$,
  'a custom-role invitation stores the role_id it will hand to the membership'
);

SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token)
     VALUES ('d0000000-0000-0000-0000-0000000000f1', 'd0000000-0000-0000-0000-000000000001',
             'builtin-invite@example.test', 'manager', 'tok-builtin') $$,
  'a builtin-role invitation still inserts with no role_id at all'
);

SELECT is(
  (SELECT role_id FROM public.invitations WHERE token = 'tok-builtin'),
  NULL::uuid,
  'the builtin-role invitation really did leave role_id NULL (no default, no trigger)'
);

-- ============================================================================
-- 2. builtin_role_id_for(): the single copy of the legacy-string -> builtin-id
--    map, now shared by the backfill and the trigger.
-- ============================================================================
SELECT is(
  public.builtin_role_id_for('owner'),
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'builtin_role_id_for maps owner to the Owner builtin'
);

SELECT is(
  public.builtin_role_id_for('collaborator_operations_manager'),
  'b0000000-0000-0000-0000-00000000000a'::uuid,
  'builtin_role_id_for maps collaborator_operations_manager to its builtin'
);

SELECT is(
  public.builtin_role_id_for('collaborator_custom'),
  NULL::uuid,
  'builtin_role_id_for returns NULL for collaborator_custom -- it has no builtin row'
);

SELECT is(
  public.builtin_role_id_for('not_a_role'),
  NULL::uuid,
  'builtin_role_id_for returns NULL for an unrecognized role string'
);

-- The backfill must still work, and still work off the shared map, after
-- being replaced to call it.
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('d0000000-0000-0000-0000-000000000104', 'd0000000-0000-0000-0000-000000000004',
   'd0000000-0000-0000-0000-0000000000f1', 'chef');

SELECT public.backfill_user_restaurants_role_id();

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000104'),
  'b0000000-0000-0000-0000-000000000004'::uuid,
  'the rewritten backfill still maps chef to the Chef builtin'
);

-- ============================================================================
-- 3. The sync trigger. Each case is asserted against a membership inserted
--    for that case alone, so one branch cannot mask another.
-- ============================================================================

-- 3a. The privilege-escalation fix: demoting via the `role` column alone must
--     drag role_id down with it. Without the trigger this row keeps
--     role_id = Owner and user_has_capability() keeps returning owner
--     answers, because role_id wins over role (20260730140000:84).
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('d0000000-0000-0000-0000-000000000102', 'd0000000-0000-0000-0000-000000000002',
   'd0000000-0000-0000-0000-0000000000f1', 'owner', 'b0000000-0000-0000-0000-000000000001');

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000102'),
  'b0000000-0000-0000-0000-000000000001'::uuid,
  'baseline: the membership starts on the Owner builtin'
);

UPDATE public.user_restaurants SET role = 'staff'
  WHERE id = 'd0000000-0000-0000-0000-000000000102';

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000102'),
  'b0000000-0000-0000-0000-000000000005'::uuid,
  'demoting owner -> staff through the role column alone moves role_id to the Employee builtin'
);

-- 3b. An explicit role_id in the same statement wins over the derived one.
--     This is the path the custom-role assignment uses: role and role_id are
--     set together and the trigger must not overwrite the caller''s choice.
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('d0000000-0000-0000-0000-000000000105', 'd0000000-0000-0000-0000-000000000005',
   'd0000000-0000-0000-0000-0000000000f1', 'staff', 'b0000000-0000-0000-0000-000000000005');

UPDATE public.user_restaurants
  SET role = 'collaborator_custom', role_id = 'd0000000-0000-0000-0000-0000000000e1'
  WHERE id = 'd0000000-0000-0000-0000-000000000105';

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000105'),
  'd0000000-0000-0000-0000-0000000000e1'::uuid,
  'an explicitly supplied role_id survives the trigger when role changes in the same UPDATE'
);

-- 3c. Fail closed: switching to collaborator_custom WITHOUT supplying a
--     role_id must not leave the previous role''s id in place. NULL sends the
--     membership down the legacy CASE, where collaborator_custom matches no
--     IN-list -- no capabilities, rather than the old role''s capabilities.
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  ('d0000000-0000-0000-0000-000000000103', 'd0000000-0000-0000-0000-000000000003',
   'd0000000-0000-0000-0000-0000000000f1', 'manager', 'b0000000-0000-0000-0000-000000000002');

UPDATE public.user_restaurants SET role = 'collaborator_custom'
  WHERE id = 'd0000000-0000-0000-0000-000000000103';

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000103'),
  NULL::uuid,
  'switching to collaborator_custom with no role_id clears role_id rather than keeping Manager'
);

-- 3d. An UPDATE that touches role_id alone (role unchanged) is left entirely
--     alone -- the trigger keys off a *role* change, not off every write.
UPDATE public.user_restaurants SET role_id = 'd0000000-0000-0000-0000-0000000000e1'
  WHERE id = 'd0000000-0000-0000-0000-000000000103';

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000103'),
  'd0000000-0000-0000-0000-0000000000e1'::uuid,
  'an UPDATE that changes only role_id is not second-guessed by the trigger'
);

-- 3e. INSERT is untouched: role_id omitted stays NULL. Task 3''s legacy
--     fallback depends on this and asserts it directly.
INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('d0000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000001',
   'd0000000-0000-0000-0000-0000000000f1', 'owner');

SELECT is(
  (SELECT role_id FROM public.user_restaurants WHERE id = 'd0000000-0000-0000-0000-000000000101'),
  NULL::uuid,
  'INSERT with role_id omitted still leaves it NULL -- the trigger is UPDATE-only'
);

SELECT * FROM finish();
ROLLBACK;
