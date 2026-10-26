-- ============================================================================
-- invitation_role_guard_test.sql
--
-- Covers supabase/migrations/20261026120200_invitation_role_guard.sql.
-- Design: docs/superpowers/specs/2026-10-26-invitation-role-guard-design.md
--
-- Browser writes run as `authenticated` with request.jwt.claims set, the
-- same state PostgREST makes, so RLS, the column grants and the trigger
-- all apply. They run inside pg_temp.as_user, which switches the role back
-- before it returns: pgTAP writes its results to temp tables that
-- `authenticated` cannot write. Server writes run as postgres, the role
-- that the trigger skips together with service_role.
--
-- All fixture data is fictional and lives only for this transaction.
-- ============================================================================
BEGIN;

SELECT plan(26);

-- ---------------------------------------------------------------- fixtures
INSERT INTO auth.users (id, email) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'guard-owner@example.test'),
  ('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test'),
  ('f2000000-0000-0000-0000-000000000003', 'guard-opsmgr@example.test'),
  ('f2000000-0000-0000-0000-000000000004', 'guard-staff@example.test'),
  ('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('f2000000-0000-0000-0000-0000000000a1', 'Invitation Guard Test Restaurant'),
  ('f2000000-0000-0000-0000-0000000000a2', 'Invitation Guard Second Restaurant');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('f2000000-0000-0000-0000-000000000001', 'f2000000-0000-0000-0000-0000000000a1', 'owner'),
  ('f2000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-0000000000a1', 'manager'),
  ('f2000000-0000-0000-0000-000000000003', 'f2000000-0000-0000-0000-0000000000a1', 'operations_manager'),
  ('f2000000-0000-0000-0000-000000000004', 'f2000000-0000-0000-0000-0000000000a1', 'staff'),
  ('f2000000-0000-0000-0000-000000000002', 'f2000000-0000-0000-0000-0000000000a2', 'manager');

-- "Users can accept their own invitations" matches the invitee by
-- profiles.email.
INSERT INTO public.profiles (user_id, email) VALUES
  ('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test')
ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email;

-- Server-side rows (postgres, so the trigger skips them):
--   b1: a valid pending staff invitation for the invitee, sent by the manager
--   b3: a valid pending staff invitation that the manager will try to edit
INSERT INTO public.invitations (id, restaurant_id, invited_by, email, role, status, token, expires_at) VALUES
  ('f2000000-0000-0000-0000-0000000000b1', 'f2000000-0000-0000-0000-0000000000a1',
   'f2000000-0000-0000-0000-000000000002', 'guard-invitee@example.test', 'staff', 'pending',
   'guard-hash-b1', now() + interval '1 day'),
  ('f2000000-0000-0000-0000-0000000000b3', 'f2000000-0000-0000-0000-0000000000a1',
   'f2000000-0000-0000-0000-000000000002', 'guard-other@example.test', 'staff', 'pending',
   'guard-hash-b3', now() + interval '1 day');

-- ---------------------------------------------------------------- helper
-- Runs p_sql as a signed-in browser session and returns 'ok' or the
-- SQLSTATE. The SQLSTATE matters: a typo that raises 42883 must not pass
-- as a privilege denial. When p_sql is a query, its first column comes
-- back as text instead of 'ok'.
CREATE OR REPLACE FUNCTION pg_temp.as_user(p_uid uuid, p_email text, p_sql text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_uid::text, 'email', p_email, 'role', 'authenticated')::text,
    true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    IF p_sql ~* '^\s*select' THEN
      EXECUTE p_sql INTO v_result;
    ELSE
      EXECUTE p_sql;
      v_result := 'ok';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_result := SQLSTATE;
  END;
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION pg_temp.invite_sql(p_inviter uuid, p_email text, p_role text)
RETURNS text LANGUAGE sql AS $$
  SELECT format(
    'INSERT INTO public.invitations (restaurant_id, invited_by, email, role, token) '
    'VALUES (%L, %L, %L, %L, %L)',
    'f2000000-0000-0000-0000-0000000000a1', p_inviter, p_email, p_role, 'tok-' || p_email);
$$;

-- ============================================================================
-- Manager
-- ============================================================================
SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000002', 'escalate@example.test', 'owner')),
  '42501',
  'a manager cannot insert an owner invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000002', 'mgr-staff@example.test', 'staff')),
  'ok',
  'a manager can insert a staff invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000002', 'mgr-mgr@example.test', 'manager')),
  'ok',
  'a manager can insert a manager invitation (INVITABLE_ROLES allows it)'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000002', 'mgr-collab@example.test', 'collaborator_accountant')),
  'ok',
  'a manager can insert a builtin collaborator invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000001', 'spoof@example.test', 'staff')),
  '42501',
  'a manager cannot insert an invitation with another invited_by'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    $$ UPDATE public.invitations SET role = 'owner'
       WHERE id = 'f2000000-0000-0000-0000-0000000000b3' $$),
  '42501',
  'a manager cannot change the role of an invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    $$ UPDATE public.invitations SET invited_by = 'f2000000-0000-0000-0000-000000000001'
       WHERE id = 'f2000000-0000-0000-0000-0000000000b3' $$),
  '42501',
  'a manager cannot change invited_by of an invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000002', 'guard-manager@example.test',
    $$ DELETE FROM public.invitations WHERE id = 'f2000000-0000-0000-0000-0000000000b3' $$),
  'ok',
  'a manager can still delete (cancel) an invitation'
);

SELECT is(
  (SELECT count(*)::int FROM public.invitations WHERE id = 'f2000000-0000-0000-0000-0000000000b3'),
  0,
  'the delete removed the row'
);

-- ============================================================================
-- Owner
-- ============================================================================
SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000001', 'guard-owner@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000001', 'own-mgr@example.test', 'manager')),
  'ok',
  'an owner can still invite a manager'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000001', 'guard-owner@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000001', 'own-own@example.test', 'owner')),
  'ok',
  'an owner can invite an owner'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000001', 'guard-owner@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000001', 'own-kiosk@example.test', 'kiosk')),
  '42501',
  'nobody can invite kiosk, the owner included'
);

-- ============================================================================
-- Operations manager and staff
-- ============================================================================
SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000003', 'guard-opsmgr@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000003', 'ops-staff@example.test', 'staff')),
  'ok',
  'an operations_manager can invite staff'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000003', 'guard-opsmgr@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000003', 'ops-chef@example.test', 'chef')),
  '42501',
  'an operations_manager cannot invite a chef'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000004', 'guard-staff@example.test',
    pg_temp.invite_sql('f2000000-0000-0000-0000-000000000004', 'staff-staff@example.test', 'staff')),
  '42501',
  'staff cannot insert an invitation'
);

-- ============================================================================
-- Invitee
-- ============================================================================
SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test',
    $$ UPDATE public.invitations
       SET role = 'owner', status = 'accepted',
           accepted_by = 'f2000000-0000-0000-0000-000000000005'
       WHERE id = 'f2000000-0000-0000-0000-0000000000b1' $$),
  '42501',
  'the invitee cannot change the role of their invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test',
    $$ UPDATE public.invitations
       SET token = 'chosen-by-invitee', status = 'accepted',
           accepted_by = 'f2000000-0000-0000-0000-000000000005'
       WHERE id = 'f2000000-0000-0000-0000-0000000000b1' $$),
  '42501',
  'the invitee cannot change the token of their invitation'
);

SELECT is(
  (SELECT role || '/' || status FROM public.invitations WHERE id = 'f2000000-0000-0000-0000-0000000000b1'),
  'staff/pending',
  'the invitation stays a pending staff invitation'
);

-- ============================================================================
-- Grants
-- ============================================================================
SELECT ok(
  has_column_privilege('authenticated', 'public.invitations', 'status', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.invitations', 'accepted_at', 'UPDATE')
  AND has_column_privilege('authenticated', 'public.invitations', 'accepted_by', 'UPDATE'),
  'authenticated can UPDATE the accept columns'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.invitations', 'role', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.invitations', 'role_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.invitations', 'token', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.invitations', 'email', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.invitations', 'restaurant_id', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.invitations', 'invited_by', 'UPDATE'),
  'authenticated cannot UPDATE role, role_id, token, email, restaurant_id or invited_by'
);

-- CASE, not AND: a missing function must fail this row, not abort the file.
SELECT ok(
  CASE WHEN to_regprocedure('public.inviter_may_invite(uuid, uuid, text)') IS NULL THEN false
       ELSE NOT has_function_privilege('authenticated', 'public.inviter_may_invite(uuid, uuid, text)', 'EXECUTE')
  END,
  'authenticated cannot call inviter_may_invite (it tells about other users)'
);

-- ============================================================================
-- Server path (send-team-invitation). The service role is a server role,
-- the same branch of the trigger as postgres. The local stack does not
-- grant INSERT on invitations to service_role
-- (tests/e2e/accountless-employee-invite.spec.ts:33-38), so this runs as
-- postgres with the service_role claim.
-- ============================================================================
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- b2: a pending owner invitation "sent" by the manager. This is the shape
-- that the old FOR ALL policy let a manager write from the browser.
SELECT lives_ok(
  $$ INSERT INTO public.invitations (id, restaurant_id, invited_by, email, role, status, token, expires_at)
     VALUES ('f2000000-0000-0000-0000-0000000000b2', 'f2000000-0000-0000-0000-0000000000a2',
             'f2000000-0000-0000-0000-000000000002', 'guard-invitee@example.test', 'owner', 'pending',
             'guard-hash-b2', now() + interval '1 day') $$,
  'a server-side writer skips the trigger (service role path still works)'
);

SELECT set_config('request.jwt.claims', '{}', true);

-- ============================================================================
-- Accept paths
-- ============================================================================
SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test',
    $$ SELECT string_agg(invitation_id::text, ',') FROM public.get_my_pending_invitations() $$),
  'f2000000-0000-0000-0000-0000000000b1',
  'get_my_pending_invitations hides the forged owner invitation'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test',
    $$ SELECT accepted::text || '/' || coalesce(reason, '')
       FROM public.accept_my_invitation('f2000000-0000-0000-0000-0000000000b2'::uuid) $$),
  'false/not_found',
  'accept_my_invitation refuses an owner invitation sent by a manager'
);

SELECT is(
  pg_temp.as_user('f2000000-0000-0000-0000-000000000005', 'guard-invitee@example.test',
    $$ SELECT accepted::text || '/' || coalesce(reason, '')
       FROM public.accept_my_invitation('f2000000-0000-0000-0000-0000000000b1'::uuid) $$),
  'true/',
  'accept_my_invitation accepts a staff invitation sent by a manager'
);

SELECT is(
  (SELECT string_agg(restaurant_id::text || ':' || role, ',') FROM public.user_restaurants
   WHERE user_id = 'f2000000-0000-0000-0000-000000000005'),
  'f2000000-0000-0000-0000-0000000000a1:staff',
  'the invitee joins only as staff, never as owner'
);

SELECT * FROM finish();
ROLLBACK;
