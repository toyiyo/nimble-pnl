-- pgTAP tests for get_my_pending_invitations and accept_my_invitation:
-- the invitee-facing, token-free pending-invitation surface.
--
-- Design: docs/superpowers/specs/2026-09-08-invite-owner-account-leak-design.md
--
-- Coverage:
--   1.  get_my_pending_invitations lists the caller's pending unexpired
--       rows, matched case-insensitively, with the restaurant name
--   2.  the return type carries no token column
--   3.  a session without an email claim gets an empty set
--   4.  accept_my_invitation happy path
--   5.  the membership row exists with the invited role
--   6.  the accountless employee record is linked
--   7.  the invitation row is marked accepted
--   8.  a second accept of the same id reports not_found
--   9.  another user's invitation reports not_found
--   10. an expired invitation reports not_found
--   11. a session without an email claim reports no_email
--   12. an existing member accepts a re-invite without an error
--   13. no duplicate membership row after the re-invite accept
--   14. the old accepted row is deleted (UNIQUE(restaurant_id,email,status))
--   15. anon holds no EXECUTE on either function
--   16. authenticated holds EXECUTE on both functions
--
-- The functions read auth.uid()/auth.email() from the JWT claims, so each
-- block sets request.jwt.claims (transaction-local) for the acting user.

BEGIN;
SELECT plan(16);

-- ---------- Fixture setup ----------
INSERT INTO restaurants (id, name) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'Pending Invite Test Restaurant'),
  ('b0000000-0000-0000-0000-000000000002', 'Other Tenant Restaurant')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO auth.users (id, email, encrypted_password, aud, role) VALUES
  ('b1111111-1111-1111-1111-111111111101', 'invitee@test.com', '', 'authenticated', 'authenticated'),
  ('b1111111-1111-1111-1111-111111111102', 'other@test.com',   '', 'authenticated', 'authenticated')
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  encrypted_password = EXCLUDED.encrypted_password,
  aud = EXCLUDED.aud,
  role = EXCLUDED.role;

-- An accountless active employee whose email matches the invitee.
INSERT INTO employees (id, restaurant_id, name, email, position, status, user_id) VALUES
  ('b2222222-2222-2222-2222-222222222201', 'b0000000-0000-0000-0000-000000000001', 'Invitee Employee', 'invitee@test.com', 'Server', 'active', NULL)
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id,
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  position = EXCLUDED.position,
  status = EXCLUDED.status,
  user_id = EXCLUDED.user_id;

-- Invitations. The stored email of the main row carries mixed case on
-- purpose: historical rows do, and the functions must match them.
INSERT INTO invitations (id, restaurant_id, invited_by, email, role, status, token, expires_at) VALUES
  -- main pending row for the invitee, mixed case
  ('c3333333-3333-3333-3333-333333333301', 'b0000000-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111102', 'Invitee@Test.com', 'staff', 'pending',   'hash-01', now() + interval '1 day'),
  -- expired pending row for the invitee (other restaurant)
  ('c3333333-3333-3333-3333-333333333302', 'b0000000-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111102', 'invitee@test.com', 'staff', 'pending',   'hash-02', now() - interval '1 day'),
  -- pending row that belongs to a different user
  ('c3333333-3333-3333-3333-333333333303', 'b0000000-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111101', 'other@test.com',   'staff', 'pending',   'hash-03', now() + interval '1 day'),
  -- cancelled row for the invitee (must never show)
  ('c3333333-3333-3333-3333-333333333304', 'b0000000-0000-0000-0000-000000000002', 'b1111111-1111-1111-1111-111111111102', 'Invitee@Test.com', 'staff', 'cancelled', 'hash-04', now() + interval '1 day')
ON CONFLICT (id) DO UPDATE SET
  restaurant_id = EXCLUDED.restaurant_id,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  expires_at = EXCLUDED.expires_at;

-- Act as the invitee.
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111101","email":"invitee@test.com","role":"authenticated"}', true);

-- ---------- 1. list: one pending unexpired row, case-insensitive ----------
SELECT results_eq(
  $$ SELECT invitation_id, restaurant_name, role FROM get_my_pending_invitations() $$,
  $$ VALUES ('c3333333-3333-3333-3333-333333333301'::uuid, 'Pending Invite Test Restaurant'::text, 'staff'::text) $$,
  'lists only the pending unexpired row, matched case-insensitively, with the restaurant name'
);

-- ---------- 2. the return type carries no token column ----------
-- Scalar subquery, not `= ANY (subquery)`: the subquery form compares
-- against each ROW (a text[] value) and fails with "malformed array
-- literal". A missing function yields NULL, and ok(NULL) fails closed.
SELECT ok(
  (SELECT NOT ('token' = ANY (proargnames))
   FROM pg_proc
   WHERE proname = 'get_my_pending_invitations'
     AND pronamespace = 'public'::regnamespace),
  'get_my_pending_invitations never returns the token column'
);

-- ---------- 3. no email claim -> empty set ----------
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111101","role":"authenticated"}', true);
SELECT is_empty(
  $$ SELECT * FROM get_my_pending_invitations() $$,
  'a session without an email claim gets an empty set'
);

-- ---------- 11 (ordered here to reuse the claim state). no_email ----------
SELECT results_eq(
  $$ SELECT accepted, reason FROM accept_my_invitation('c3333333-3333-3333-3333-333333333301'::uuid) $$,
  $$ VALUES (false, 'no_email'::text) $$,
  'accept without an email claim reports no_email'
);

-- Back to the invitee.
SELECT set_config('request.jwt.claims', '{"sub":"b1111111-1111-1111-1111-111111111101","email":"invitee@test.com","role":"authenticated"}', true);

-- ---------- 4. happy path ----------
SELECT results_eq(
  $$ SELECT accepted, restaurant_id, restaurant_name, reason
     FROM accept_my_invitation('c3333333-3333-3333-3333-333333333301'::uuid) $$,
  $$ VALUES (true, 'b0000000-0000-0000-0000-000000000001'::uuid, 'Pending Invite Test Restaurant'::text, NULL::text) $$,
  'accept_my_invitation accepts the caller''s pending invitation'
);

-- ---------- 5. membership row with the invited role ----------
SELECT is(
  (SELECT ur.role FROM user_restaurants ur
   WHERE ur.user_id = 'b1111111-1111-1111-1111-111111111101'
     AND ur.restaurant_id = 'b0000000-0000-0000-0000-000000000001'),
  'staff',
  'the membership row exists with the invited role'
);

-- ---------- 6. the accountless employee record is linked ----------
SELECT is(
  (SELECT user_id FROM employees WHERE id = 'b2222222-2222-2222-2222-222222222201'),
  'b1111111-1111-1111-1111-111111111101'::uuid,
  'the accountless employee record is linked to the invitee'
);

-- ---------- 7. the invitation row is marked accepted ----------
SELECT results_eq(
  $$ SELECT status, accepted_by FROM invitations
     WHERE id = 'c3333333-3333-3333-3333-333333333301' $$,
  $$ VALUES ('accepted'::text, 'b1111111-1111-1111-1111-111111111101'::uuid) $$,
  'the invitation row is marked accepted with accepted_by'
);

-- ---------- 8. a second accept of the same id reports not_found ----------
SELECT results_eq(
  $$ SELECT accepted, reason FROM accept_my_invitation('c3333333-3333-3333-3333-333333333301'::uuid) $$,
  $$ VALUES (false, 'not_found'::text) $$,
  'a second accept of the same id reports not_found'
);

-- ---------- 9. another user''s invitation reports not_found ----------
SELECT results_eq(
  $$ SELECT accepted, reason FROM accept_my_invitation('c3333333-3333-3333-3333-333333333303'::uuid) $$,
  $$ VALUES (false, 'not_found'::text) $$,
  'another user''s invitation reports not_found (no probe oracle)'
);

-- ---------- 10. an expired invitation reports not_found ----------
SELECT results_eq(
  $$ SELECT accepted, reason FROM accept_my_invitation('c3333333-3333-3333-3333-333333333302'::uuid) $$,
  $$ VALUES (false, 'not_found'::text) $$,
  'an expired invitation reports not_found'
);

-- ---------- 12-14. re-invite of an existing member ----------
-- The first row is now status='accepted'. A re-invite creates a fresh
-- pending row with the same restaurant + email.
INSERT INTO invitations (id, restaurant_id, invited_by, email, role, status, token, expires_at) VALUES
  ('c3333333-3333-3333-3333-333333333305', 'b0000000-0000-0000-0000-000000000001', 'b1111111-1111-1111-1111-111111111102', 'Invitee@Test.com', 'staff', 'pending', 'hash-05', now() + interval '1 day');

SELECT results_eq(
  $$ SELECT accepted, reason FROM accept_my_invitation('c3333333-3333-3333-3333-333333333305'::uuid) $$,
  $$ VALUES (true, NULL::text) $$,
  'an existing member accepts a re-invite without an error (unique_violation handler)'
);

SELECT is(
  (SELECT count(*) FROM user_restaurants ur
   WHERE ur.user_id = 'b1111111-1111-1111-1111-111111111101'
     AND ur.restaurant_id = 'b0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'no duplicate membership row after the re-invite accept'
);

SELECT is(
  (SELECT count(*) FROM invitations i
   WHERE i.restaurant_id = 'b0000000-0000-0000-0000-000000000001'
     AND i.email = 'Invitee@Test.com'
     AND i.status = 'accepted'),
  1::bigint,
  'the old accepted row is deleted before the new one flips to accepted'
);

-- ---------- 15-16. privilege boundary ----------
SELECT ok(
  NOT has_function_privilege('anon', 'public.get_my_pending_invitations()', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.accept_my_invitation(uuid)', 'EXECUTE'),
  'anon holds no EXECUTE on either function'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.get_my_pending_invitations()', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.accept_my_invitation(uuid)', 'EXECUTE'),
  'authenticated holds EXECUTE on both functions'
);

SELECT * FROM finish();
ROLLBACK;
