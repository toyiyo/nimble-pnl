-- ============================================================================
-- invitation_role_id_agreement_test.sql
--
-- Covers supabase/migrations/
-- 20260730210000_invitation_role_id_must_agree_with_role.sql.
--
-- The migration closes a privilege escalation this branch introduced. The
-- first assertion below is the escalation itself, written as the attacker
-- would: a manager inserting role='staff' with the Owner builtin's id. It
-- fails against the pre-migration trigger -- which checked tenancy only, and
-- passed every global builtin -- so this file cannot go green by accident.
--
-- Why the escalation works without the fix: the invitations write policy is
-- FOR ALL with no WITH CHECK, so its USING expression is reused for INSERT
-- and tests only the caller's rights over restaurant_id; accept-invitation
-- copies invitation.role_id onto user_restaurants verbatim; and
-- user_has_capability() dispatches on role_id whenever it is non-NULL,
-- never re-reading the role string.
--
-- Everything runs with row_security off, because the trigger -- not RLS -- is
-- the thing under test, and because the service-role writers that matter here
-- (accept-invitation, send-team-invitation) bypass RLS entirely and still
-- have to be held.
--
-- All fixture data is fictional and lives only for this transaction.
-- ============================================================================
BEGIN;

SELECT plan(10);

SET LOCAL row_security = off;

INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'agree-manager@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('d1000000-0000-0000-0000-0000000000f1', 'Role Agreement Test Restaurant'),
  ('d1000000-0000-0000-0000-0000000000f2', 'Role Agreement Other Tenant');

INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin) VALUES
  -- The ordinary custom role: collaborator-flavored, owned by f1.
  ('d1000000-0000-0000-0000-0000000000e1', 'd1000000-0000-0000-0000-0000000000f1',
   'Weekend Supervisor', 'Custom role for the invite path', 'collaborator', false),
  -- Same restaurant, but platform-flavored. Not a shape the RLS write
  -- policies admit -- which is exactly why the trigger has to reject it too,
  -- since service-role writers never meet those policies.
  ('d1000000-0000-0000-0000-0000000000e2', 'd1000000-0000-0000-0000-0000000000f1',
   'Platform Flavored', 'Not grantable by invitation', 'platform', false),
  -- A perfectly ordinary custom role, owned by somebody else.
  ('d1000000-0000-0000-0000-0000000000e3', 'd1000000-0000-0000-0000-0000000000f2',
   'Other Tenant Role', 'Custom role owned by a different restaurant', 'collaborator', false);

-- ============================================================================
-- 1. The escalation. Denied baseline for the whole file.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'escalate@example.test', 'staff', 'tok-escalate',
             'b0000000-0000-0000-0000-000000000001') $$,
  '42501',
  NULL,
  'role=staff cannot carry the Owner builtin''s id -- the escalation this migration closes'
);

-- Same defect reached by UPDATE. The trigger is BEFORE INSERT OR UPDATE, and
-- an invitation that was written honestly can be repointed afterwards.
SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'honest@example.test', 'staff', 'tok-honest',
             'b0000000-0000-0000-0000-000000000005') $$,
  'role=staff may carry the Staff builtin''s id -- role and role_id agree'
);

SELECT throws_ok(
  $$ UPDATE public.invitations
       SET role_id = 'b0000000-0000-0000-0000-000000000001'
     WHERE token = 'tok-honest' $$,
  '42501',
  NULL,
  'an accepted-shape invitation cannot be repointed at the Owner builtin afterwards'
);

-- ============================================================================
-- 2. collaborator_custom + a builtin id. The case send-team-invitation's own
--    comment calls out: "a manager naming the Owner builtin". Rejected
--    because builtin_role_id_for('collaborator_custom') is NULL, so nothing
--    a builtin row could be equals it.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'custom-names-builtin@example.test', 'collaborator_custom', 'tok-custom-builtin',
             'b0000000-0000-0000-0000-000000000001') $$,
  '42501',
  NULL,
  'collaborator_custom cannot be pointed at a builtin role'
);

-- ============================================================================
-- 3. The allowance 20260730170000 made on purpose survives: a builtin invite
--    may carry the matching builtin's id. Narrowing to "role_id only ever
--    means a custom role" would have broken this.
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'builtin-match@example.test', 'manager', 'tok-builtin-match',
             'b0000000-0000-0000-0000-000000000002') $$,
  'role=manager may carry the Manager builtin''s id'
);

-- ============================================================================
-- 4. A custom (non-builtin) role is grantable only through a custom-role
--    invite. Pairing one with a builtin role string is the mirror image of
--    section 1 and equally incoherent.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'custom-as-manager@example.test', 'manager', 'tok-custom-as-manager',
             'd1000000-0000-0000-0000-0000000000e1') $$,
  '42501',
  NULL,
  'a custom role_id requires role = collaborator_custom, not a builtin string'
);

-- ============================================================================
-- 5. flavor and tenancy, the two checks the edge function makes that the
--    original trigger either skipped or made alone.
-- ============================================================================
SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'platform-flavored@example.test', 'collaborator_custom', 'tok-platform',
             'd1000000-0000-0000-0000-0000000000e2') $$,
  '42501',
  NULL,
  'a platform-flavored role is not invitable, even from its own restaurant'
);

SELECT throws_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'cross-tenant@example.test', 'collaborator_custom', 'tok-cross',
             'd1000000-0000-0000-0000-0000000000e3') $$,
  '42501',
  NULL,
  'a custom role owned by another restaurant is still rejected'
);

-- ============================================================================
-- 6. The legitimate paths still work -- the trigger rejects disagreement, not
--    "role_id is set at all".
-- ============================================================================
SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token, role_id)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'legit-custom@example.test', 'collaborator_custom', 'tok-legit-custom',
             'd1000000-0000-0000-0000-0000000000e1') $$,
  'a collaborator-flavored custom role owned by the inviting restaurant is invitable'
);

SELECT lives_ok(
  $$ INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token)
     VALUES ('d1000000-0000-0000-0000-0000000000f1', 'd1000000-0000-0000-0000-000000000001',
             'no-role-id@example.test', 'chef', 'tok-no-role-id') $$,
  'an invitation with no role_id is untouched -- the legacy path keeps working'
);

RESET row_security;

SELECT * FROM finish();
ROLLBACK;
