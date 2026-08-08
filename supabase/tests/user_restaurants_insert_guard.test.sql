-- ============================================================================
-- user_restaurants_insert_guard.test.sql
--
-- pgTAP coverage for the fix that closes the self-grant hole on
-- `public.user_restaurants` INSERT. See
-- docs/superpowers/specs/2026-08-08-user-restaurants-insert-guard-design.md.
--
-- The problem: "Users can insert their own restaurant associations"
-- (supabase/migrations/20250915210020_774bc2c1-abb6-4f03-b10f-5cfc85e9b772.sql:61)
-- is PERMISSIVE and only checks `user_id = auth.uid()`. Any authenticated
-- user can insert themselves into any restaurant as `owner`. The fix adds a
-- RESTRICTIVE INSERT policy that requires the actor to already own the
-- target restaurant, and drops the old permissive policy.
--
-- Run as the real `authenticated` role with JWT claims so RLS is actually
-- enforced — as superuser these policies do not apply at all.
--
-- All fixture data (restaurant/user ids, emails) is fictional and exists
-- only for the duration of this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(11);

-- ----------------------------------------------------------------------------
-- Fixtures: two restaurants, four users. `d0000000-…` prefix so the ids do
-- not collide with any other test file.
--
--   restaurant A (d0000000-...-00000000a1) — the victim tenant
--   restaurant B (d0000000-...-00000000b1) — a second tenant, unrelated to A
--   OWNER       (...01) — owner of restaurant A
--   STRANGER    (...02) — member of nothing
--   STAFF       (...03) — staff of restaurant A only
--   TARGET      (...04) — the person an owner adds; member of nothing
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'urig-owner@example.test'),
  ('d0000000-0000-0000-0000-000000000002', 'urig-stranger@example.test'),
  ('d0000000-0000-0000-0000-000000000003', 'urig-staff@example.test'),
  ('d0000000-0000-0000-0000-000000000004', 'urig-target@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('d0000000-0000-0000-0000-0000000000a1', 'Insert Guard Test Restaurant A'),
  ('d0000000-0000-0000-0000-0000000000b1', 'Insert Guard Test Restaurant B');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  ('d0000000-0000-0000-0000-000000000101', 'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-0000000000a1', 'owner'),
  ('d0000000-0000-0000-0000-000000000102', 'd0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-0000000000a1', 'staff');

-- ============================================================================
-- 1-3. STRANGER self-inserts into restaurant A at three different roles.
--    Each is a self-insert (user_id = auth.uid()), so the permissive set
--    already admits the row. Only the new RESTRICTIVE policy can deny it.
--    Pinned to 42501 so a 23505 (unique_violation) never masquerades as a
--    pass — see the warning in the plan for why that matters.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000a1', 'owner') $$,
  '42501',
  NULL,
  'a stranger cannot self-insert into another restaurant as owner'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000a1', 'staff') $$,
  '42501',
  NULL,
  'a stranger cannot self-insert into another restaurant as staff'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000a1', 'manager') $$,
  '42501',
  NULL,
  'a stranger cannot self-insert into another restaurant as manager'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 4. An existing member of A (staff) self-inserts into B, where they hold no
--    row. Proves membership elsewhere does not grant insert rights on an
--    unrelated tenant.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000003","role":"authenticated"}';

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-0000000000b1', 'owner') $$,
  '42501',
  NULL,
  'a staff member of A cannot self-insert into unrelated restaurant B as owner'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 5-6. Real OWNER of A inserts TARGET into A. Positive control: the guard is
--    not a blanket denial. Both cases write the same (TARGET, A) pair, so
--    run 5, delete the row, then run 6 — a second insert raises 23505.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000a1', 'staff') $$,
  'an owner may insert another user into their restaurant as staff'
);

DELETE FROM public.user_restaurants
 WHERE user_id = 'd0000000-0000-0000-0000-000000000004'
   AND restaurant_id = 'd0000000-0000-0000-0000-0000000000a1';

SELECT lives_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-0000000000a1', 'owner') $$,
  'an owner may insert another user into their restaurant as owner'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 7. Bootstrap regression guard: create_restaurant_with_owner() must still
--    work for a brand-new user who owns nothing yet. Proves the
--    SECURITY DEFINER bypass still holds. Run last among the write cases —
--    it creates a restaurant row the earlier assertions do not expect.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"d0000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT public.create_restaurant_with_owner('Insert Guard Bootstrap Restaurant') $$,
  'create_restaurant_with_owner still bootstraps a new owner row'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 8. Non-vacuity control for cases 1-3: STRANGER fails is_restaurant_owner
--    on A. Proves the denial above comes from the new policy predicate, not
--    from some unrelated grant.
-- ============================================================================
SELECT is(
  public.is_restaurant_owner('d0000000-0000-0000-0000-0000000000a1', 'd0000000-0000-0000-0000-000000000002'),
  false,
  'stranger is not an owner of restaurant A'
);

-- ============================================================================
-- 9. The new policy exists, is RESTRICTIVE, and is scoped to INSERT.
-- ============================================================================
SELECT is(
  (SELECT permissive FROM pg_policies
    WHERE tablename = 'user_restaurants'
      AND policyname = 'Only owners can insert restaurant associations'
      AND cmd = 'INSERT'),
  'RESTRICTIVE',
  'the new insert guard policy is RESTRICTIVE and scoped to INSERT'
);

-- ============================================================================
-- 10. The old permissive self-insert policy is gone.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE tablename = 'user_restaurants'
      AND policyname = 'Users can insert their own restaurant associations'),
  0,
  'the old permissive self-insert policy no longer exists'
);

-- ============================================================================
-- 11. Anon-role boundary. Runs as the real `anon` role (no `sub` claim), not
--    as `authenticated` with a stub id.
--
--    This case does NOT pin the new RESTRICTIVE policy or
--    is_restaurant_owner()'s NULL handling. By default `anon` has only
--    SELECT on public.user_restaurants (see
--    supabase/migrations/20260628000000_grant_user_restaurants_select.sql)
--    and Postgres checks table-level grants before RLS, so this INSERT is
--    denied at the grant-check stage — it never reaches the RESTRICTIVE
--    policy's WITH CHECK. Even granting anon INSERT for this test would not
--    reach the policy either: the pre-existing permissive "Owners can
--    manage restaurant associations" WITH CHECK
--    (user_id = auth.uid() OR is_restaurant_owner(...)) already denies any
--    anon insert on its own, since auth.uid() is NULL for anon and user_id
--    is never NULL.
--
--    The weaker, true guarantee this case pins: the anon role cannot insert
--    into user_restaurants at all, today, for this exact reason (the
--    missing table grant). The error message is checked, not just the
--    SQLSTATE, so a future migration that grants anon INSERT — which would
--    change *why* anon is denied, even though anon would still end up
--    denied by the permissive policy above — fails here instead of shipping
--    a silently changed guarantee.
-- ============================================================================
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claims = '{"role":"anon"}';

SELECT throws_ok(
  $$ INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
     VALUES ('d0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-0000000000a1', 'owner') $$,
  '42501',
  'permission denied for table user_restaurants',
  'the anon role cannot insert into user_restaurants at all'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT * FROM finish();
ROLLBACK;
