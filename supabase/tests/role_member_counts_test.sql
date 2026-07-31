-- ============================================================================
-- role_member_counts_test.sql
--
-- Coverage for public.role_member_counts (supabase/migrations/
-- 20260730200000_role_member_counts.sql), the server-side replacement for the
-- client-side headcount in src/hooks/useRoles.ts.
--
-- The bug it exists to fix: the client counted `user_restaurants.role_id`
-- alone, and role_id is legitimately NULL on memberships written by code paths
-- that set only the legacy `role` string (20260730170000's sync trigger is
-- UPDATE-only, and its header states an INSERT that omits role_id must keep
-- leaving it NULL). Section 2 below is written so it would FAIL against the
-- old role_id-only count, not merely pass against the new one.
--
-- Expected builtin ids are transcribed from
-- 20260730110000_seed_builtin_roles.sql rather than read back through
-- builtin_role_id_for(), so the mapping is checked rather than reflected.
--
-- All fixture data is fictional and lives only for this transaction. The ids
-- use the d2000000- prefix so they cannot collide with the d0000000- space
-- invitation_role_id_test.sql claims or the d1000000- space
-- invitation_role_id_agreement_test.sql claims. run_tests.sh gives each file
-- its own psql process and every file rolls back, so nothing overlaps today --
-- the distinct prefix is what keeps that true if the files are ever run
-- together, and is why none of these fixtures need ON CONFLICT (a duplicate
-- inside one file is a bug worth failing on, not one worth absorbing).
-- ============================================================================
BEGIN;

SELECT plan(11);

-- ----------------------------------------------------------------------------
-- Fixtures: two restaurants, so scoping is testable, and one custom role.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('d2000000-0000-0000-0000-000000000001', 'rmc-owner@example.test'),
  ('d2000000-0000-0000-0000-000000000002', 'rmc-legacy-manager-a@example.test'),
  ('d2000000-0000-0000-0000-000000000003', 'rmc-legacy-manager-b@example.test'),
  ('d2000000-0000-0000-0000-000000000004', 'rmc-explicit-manager@example.test'),
  ('d2000000-0000-0000-0000-000000000005', 'rmc-custom@example.test'),
  ('d2000000-0000-0000-0000-000000000006', 'rmc-custom-unresolved@example.test'),
  ('d2000000-0000-0000-0000-000000000007', 'rmc-other-restaurant-owner@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('d2000000-0000-0000-0000-0000000000f1', 'Member Count Test Restaurant'),
  ('d2000000-0000-0000-0000-0000000000f2', 'Member Count Other Restaurant');

INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('d2000000-0000-0000-0000-0000000000c1', 'd2000000-0000-0000-0000-0000000000f1',
   'Weekend Floor Lead', 'collaborator', false);

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role, role_id) VALUES
  -- role_id explicitly set: countable by either implementation.
  ('d2000000-0000-0000-0000-000000000101', 'd2000000-0000-0000-0000-000000000001',
   'd2000000-0000-0000-0000-0000000000f1', 'owner', 'b0000000-0000-0000-0000-000000000001'),
  ('d2000000-0000-0000-0000-000000000104', 'd2000000-0000-0000-0000-000000000004',
   'd2000000-0000-0000-0000-0000000000f1', 'manager', 'b0000000-0000-0000-0000-000000000002'),
  -- A custom-role membership: role string is the bare literal, role_id points
  -- at the restaurant's own role row.
  ('d2000000-0000-0000-0000-000000000105', 'd2000000-0000-0000-0000-000000000005',
   'd2000000-0000-0000-0000-0000000000f1', 'collaborator_custom', 'd2000000-0000-0000-0000-0000000000c1'),
  -- Same builtin role, different restaurant. A builtin roles row is global, so
  -- this is the row an unscoped count would wrongly fold in.
  ('d2000000-0000-0000-0000-000000000107', 'd2000000-0000-0000-0000-000000000007',
   'd2000000-0000-0000-0000-0000000000f2', 'owner', 'b0000000-0000-0000-0000-000000000001');

INSERT INTO public.user_restaurants (id, user_id, restaurant_id, role) VALUES
  -- role_id omitted, exactly as the sync trigger's header says an INSERT may
  -- do. These two are what the old count dropped.
  ('d2000000-0000-0000-0000-000000000102', 'd2000000-0000-0000-0000-000000000002',
   'd2000000-0000-0000-0000-0000000000f1', 'manager'),
  ('d2000000-0000-0000-0000-000000000103', 'd2000000-0000-0000-0000-000000000003',
   'd2000000-0000-0000-0000-0000000000f1', 'manager'),
  -- collaborator_custom with no role_id: resolves to no role at all, because
  -- builtin_role_id_for returns NULL for it. Must be dropped, not bucketed.
  ('d2000000-0000-0000-0000-000000000106', 'd2000000-0000-0000-0000-000000000006',
   'd2000000-0000-0000-0000-0000000000f1', 'collaborator_custom');

-- ============================================================================
-- 1. The function exists with the expected signature and is SECURITY INVOKER.
--
--    INVOKER is the security property, not an implementation detail: a DEFINER
--    version would return per-role headcounts for any restaurant_id a caller
--    cared to pass, turning a badge into a cross-tenant oracle.
-- ============================================================================
SELECT has_function(
  'public', 'role_member_counts', ARRAY['uuid'],
  'role_member_counts(uuid) exists'
);

SELECT is(
  (SELECT p.prosecdef FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'role_member_counts'),
  false,
  'role_member_counts is SECURITY INVOKER, so it cannot count across tenants'
);

-- ============================================================================
-- 2. The regression itself: memberships with a NULL role_id are counted.
--
--    Denied baseline first, so this cannot pass vacuously — three managers
--    exist in this restaurant and only one of them carries a role_id.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.user_restaurants
     WHERE restaurant_id = 'd2000000-0000-0000-0000-0000000000f1'
       AND role = 'manager' AND role_id IS NULL),
  2,
  'baseline: two of the three manager memberships have no role_id'
);

SELECT is(
  (SELECT member_count::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')
     WHERE role_id = 'b0000000-0000-0000-0000-000000000002'),
  3,
  'all three managers are counted, including the two resolved from the legacy role string'
);

-- ============================================================================
-- 3. Scoping: a builtin role is global, the count is not.
-- ============================================================================
SELECT is(
  (SELECT member_count::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')
     WHERE role_id = 'b0000000-0000-0000-0000-000000000001'),
  1,
  'the Owner builtin counts only this restaurant''s owner, not the other restaurant''s'
);

SELECT is(
  (SELECT member_count::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f2')
     WHERE role_id = 'b0000000-0000-0000-0000-000000000001'),
  1,
  'the other restaurant sees its own owner on the same global builtin row'
);

-- ============================================================================
-- 4. Custom roles are counted on their own row.
-- ============================================================================
SELECT is(
  (SELECT member_count::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')
     WHERE role_id = 'd2000000-0000-0000-0000-0000000000c1'),
  1,
  'a custom-role membership is counted against its custom roles row'
);

-- ============================================================================
-- 5. Unresolvable memberships are dropped, not bucketed under a NULL key.
--
--    A NULL row would reach the client as a map entry keyed by null and could
--    surface as a phantom count on whichever card read it back.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')
     WHERE role_id IS NULL),
  0,
  'a collaborator_custom membership with no role_id produces no row at all'
);

-- ============================================================================
-- 6. No stray buckets: exactly the three roles above are reported, and the
--    total counted equals the memberships that could be resolved (6 rows in
--    this restaurant, 1 of them unresolvable).
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')),
  3,
  'exactly three roles are reported for this restaurant'
);

SELECT is(
  (SELECT COALESCE(sum(member_count), 0)::int
     FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000f1')),
  5,
  'five of the six memberships resolve to a role and are counted exactly once'
);

-- ============================================================================
-- 7. A restaurant with no memberships returns no rows rather than erroring —
--    the client renders that as "nobody is assigned yet" on every card.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int
     FROM public.role_member_counts('d2000000-0000-0000-0000-0000000000ff')),
  0,
  'an unknown restaurant_id returns zero rows rather than raising'
);

SELECT * FROM finish();
ROLLBACK;
