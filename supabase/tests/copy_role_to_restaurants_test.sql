-- ============================================================================
-- copy_role_to_restaurants_test.sql
--
-- Sub-task 9h of the "data-driven roles built from areas" design
-- (docs/superpowers/specs/2026-07-29-roles-and-areas-design.md), pulled
-- forward ahead of the rest of task 9 so task 8d's useRoles.ts hook has a
-- real RPC to call for its copy mutation. RED test for
-- supabase/migrations/20260730160000_copy_role_to_restaurants.sql — a
-- SECURITY DEFINER RPC that clones a custom role's roles/role_areas/
-- role_flags rows into each target restaurant, after checking the caller
-- holds manage:collaborators IN THAT TARGET.
--
-- The design doc is explicit that this check is not defense in depth, it is
-- the *only* gate (SECURITY DEFINER bypasses RLS on roles/role_areas/
-- role_flags entirely for this code path), and that it "must run before any
-- INSERT, not interleaved with them." This file asserts that literally:
-- every unauthorized/invalid case is checked by row COUNT before and after,
-- not merely by catching an exception, and the atomicity assertion (B)
-- proves a target the caller *is* authorized for still gets zero rows when
-- another target in the same call is not authorized.
--
-- Covered, denied-baseline-first throughout:
--  A. A member of the target restaurant who lacks manage:collaborators
--     there: call raises, roles/role_areas counts in that target are 0
--     before and 0 after (not just "an exception was thrown").
--  B. Atomicity across multiple targets in one call: caller is authorized in
--     one target and not in a second target in the same invocation -> the
--     whole call raises and the authorized target also gets zero rows. This
--     is the literal test of "the gate runs before any INSERT, not
--     interleaved with them."
--  C. Success + name collision, exercised together in one multi-target
--     call: an authorized-and-uncollided target gets a full, faithful clone
--     (name/description/flavor/builtin=false plus every role_areas and
--     role_flags row); an authorized-but-colliding target (an existing role
--     there already has that name, case-insensitively) is reported back in
--     the returned JSON and gets no new row, rather than being silently
--     suffixed (the [2026-07-09] label-collision lesson).
--  D. A builtin role cannot be used as the copy source (builtins are global
--     already, restaurant_id IS NULL — there is nothing restaurant-scoped to
--     clone from, and cloning one into a restaurant would immediately
--     collide with roles_reject_builtin_name_collision anyway).
--  E. A nonexistent source role_id raises rather than silently no-op'ing.
--  F. The SOURCE restaurant is gated too: a caller who holds
--     manage:collaborators in the target but has no membership at all in the
--     source restaurant is denied. SECURITY DEFINER bypasses RLS on the
--     source SELECT exactly as it bypasses the writes, so without a source
--     gate this RPC would be a cross-tenant read primitive — name another
--     tenant's role_id and learn its name, description, areas and flags by
--     cloning them into a restaurant you do administer. Every other caller
--     in this file is therefore a member of the source restaurant, so that
--     A-E fail for the reason each of them names and not incidentally on
--     the source gate.
--
-- All fixture rows exist only for the duration of this transaction
-- (ROLLBACK).
-- ============================================================================

BEGIN;

SELECT plan(30);

-- ----------------------------------------------------------------------------
-- Fixture: restaurants. S is the source (owns the custom role being
-- copied). T1-T6 are copy targets, one per scenario below so no scenario's
-- assertions can be contaminated by another's inserts.
-- ----------------------------------------------------------------------------
INSERT INTO public.restaurants (id, name) VALUES
  ('9c000000-0000-0000-0000-00000000005a', 'Task 9h Source Restaurant'),
  ('9c000000-0000-0000-0000-000000000001', 'Task 9h Target T1 (denied baseline)'),
  ('9c000000-0000-0000-0000-000000000002', 'Task 9h Target T2 (authorized half of atomicity pair)'),
  ('9c000000-0000-0000-0000-000000000003', 'Task 9h Target T3 (unauthorized half of atomicity pair)'),
  ('9c000000-0000-0000-0000-000000000004', 'Task 9h Target T4 (clean success)'),
  ('9c000000-0000-0000-0000-000000000005', 'Task 9h Target T5 (name collision)'),
  ('9c000000-0000-0000-0000-000000000006', 'Task 9h Target T6 (builtin-source rejection)'),
  ('9c000000-0000-0000-0000-000000000007', 'Task 9h Target T7 (source-gate rejection)')
ON CONFLICT (id) DO NOTHING;

-- Source custom role: collaborator-flavored (matches the design's decided
-- trade-off that custom roles are collaborator-flavored in this phase),
-- granted two areas within its collaborator caps (inventory:view,
-- scheduling:manage — area_catalog caps both at 'manage') plus one sensitive
-- flag, so cloning it exercises both child tables faithfully.
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '9c000000-0000-0000-0000-0000000000aa',
  '9c000000-0000-0000-0000-00000000005a',
  'Task 9h Source Role',
  'pgTAP fixture — role to be copied',
  'collaborator',
  false
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('9c000000-0000-0000-0000-0000000000aa', 'inventory', 'view'),
  ('9c000000-0000-0000-0000-0000000000aa', 'scheduling', 'manage')
ON CONFLICT (role_id, area_key) DO UPDATE SET level = EXCLUDED.level;

INSERT INTO public.role_flags (role_id, flag) VALUES
  ('9c000000-0000-0000-0000-0000000000aa', 'view:costs')
ON CONFLICT (role_id, flag) DO NOTHING;

-- Pre-existing role in T5 that collides case-insensitively with the source
-- role's name, so the collision path has something real to collide with.
INSERT INTO public.roles (id, restaurant_id, name, description, flavor, builtin)
VALUES (
  '9c000000-0000-0000-0000-0000000000c5',
  '9c000000-0000-0000-0000-000000000005',
  'task 9h source role',
  'pgTAP fixture — pre-existing role that collides with the source role''s name',
  'collaborator',
  false
)
ON CONFLICT (id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Fixture: users and memberships.
--   userA: member of T1 as legacy 'staff' -> no manage:collaborators there.
--   userB: member of T2 as legacy 'owner' (authorized) and NOT a member of
--          T3 at all (unauthorized there) -> the atomicity pair.
--   userC: member of T4 and T5, both as legacy 'owner' (authorized in both).
--   userD: member of T6 as legacy 'owner' (authorized), used for the
--          builtin-source-rejection and nonexistent-role_id cases.
--   userE: member of T7 as legacy 'owner' (authorized in the target) but NOT
--          a member of S at all -> the source-gate case (F).
--
-- userA-userD are all owners of S as well. That is not incidental: the
-- source gate raises before the target loop runs, so without membership in
-- S every one of A-E would raise on the source check and pass for a reason
-- it does not claim to be testing. userE is deliberately left out of S.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('9c000000-0000-0000-0000-0000000000b1', 'task9h-usera@example.com'),
  ('9c000000-0000-0000-0000-0000000000b2', 'task9h-userb@example.com'),
  ('9c000000-0000-0000-0000-0000000000b3', 'task9h-userc@example.com'),
  ('9c000000-0000-0000-0000-0000000000b4', 'task9h-userd@example.com'),
  ('9c000000-0000-0000-0000-0000000000b5', 'task9h-usere@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('9c000000-0000-0000-0000-0000000000b1', '9c000000-0000-0000-0000-00000000005a', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b2', '9c000000-0000-0000-0000-00000000005a', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b3', '9c000000-0000-0000-0000-00000000005a', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b4', '9c000000-0000-0000-0000-00000000005a', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b1', '9c000000-0000-0000-0000-000000000001', 'staff'),
  ('9c000000-0000-0000-0000-0000000000b2', '9c000000-0000-0000-0000-000000000002', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b3', '9c000000-0000-0000-0000-000000000004', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b3', '9c000000-0000-0000-0000-000000000005', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b4', '9c000000-0000-0000-0000-000000000006', 'owner'),
  ('9c000000-0000-0000-0000-0000000000b5', '9c000000-0000-0000-0000-000000000007', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- ----------------------------------------------------------------------------
-- Generic RLS/RPC-scoped-execution helpers (same pattern as
-- collaborator_custom_rls_test.sql: switch role+jwt claims, run, switch
-- back).
-- ----------------------------------------------------------------------------

-- Calls copy_role_to_restaurants as p_user_id and returns 'raised' or the
-- function's JSONB result stringified. Never lets an exception escape the
-- transaction, so callers can assert on the outcome without ROLLBACK firing
-- early.
CREATE OR REPLACE FUNCTION pg_temp.as_user_copy(
  p_user_id UUID,
  p_role_id UUID,
  p_target_ids UUID[]
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true);
  BEGIN
    SELECT public.copy_role_to_restaurants(p_role_id, p_target_ids) INTO v_result;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role', 'postgres', true);
    RETURN 'raised';
  END;
  PERFORM set_config('role', 'postgres', true);
  RETURN v_result::text;
END;
$$;

-- ============================================================================
-- A. Denied baseline: userA is a real member of T1 but holds no
--    manage:collaborators there (legacy 'staff'). Row counts checked before
--    and after, not just "the call raised".
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000001'),
  0,
  'A: pre-count — T1 has zero roles before the unauthorized call'
);

SELECT is(
  pg_temp.as_user_copy(
    '9c000000-0000-0000-0000-0000000000b1'::uuid,
    '9c000000-0000-0000-0000-0000000000aa'::uuid,
    ARRAY['9c000000-0000-0000-0000-000000000001'::uuid]
  ),
  'raised',
  'A: a member of the target without manage:collaborators there is denied'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000001'),
  0,
  'A: post-count — T1 still has zero roles, the unauthorized call inserted nothing'
);

SELECT is(
  (
    SELECT count(*)::int FROM public.role_areas ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE r.restaurant_id = '9c000000-0000-0000-0000-000000000001'
  ),
  0,
  'A: post-count — T1 has zero role_areas rows, confirming no partial child insert either'
);

-- ============================================================================
-- B. Atomicity: userB is authorized in T2 but has no membership at all in
--    T3. A single call naming both targets must raise, and T2 -- the
--    target userB *is* authorized for -- must still end up with zero new
--    rows. This is the literal test of "runs before any INSERT, not
--    interleaved with them."
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000002'),
  0,
  'B: pre-count — T2 has zero roles before the mixed-authorization call'
);

SELECT is(
  pg_temp.as_user_copy(
    '9c000000-0000-0000-0000-0000000000b2'::uuid,
    '9c000000-0000-0000-0000-0000000000aa'::uuid,
    ARRAY[
      '9c000000-0000-0000-0000-000000000002'::uuid,
      '9c000000-0000-0000-0000-000000000003'::uuid
    ]
  ),
  'raised',
  'B: a call naming one authorized and one unauthorized target is denied outright'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000002'),
  0,
  'B: post-count — T2 (the authorized target) still has zero roles: no partial insert leaked through'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000003'),
  0,
  'B: post-count — T3 (the unauthorized target) also has zero roles'
);

-- ============================================================================
-- C. Success + name collision, in one multi-target call. userC is
--    authorized in both T4 (clean) and T5 (pre-existing name collision).
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004'),
  0,
  'C: pre-count — T4 has zero roles before the call'
);
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000005'),
  1,
  'C: pre-count — T5 has exactly its one pre-existing, colliding role before the call'
);

CREATE TEMP TABLE task9h_copy_result AS
SELECT pg_temp.as_user_copy(
  '9c000000-0000-0000-0000-0000000000b3'::uuid,
  '9c000000-0000-0000-0000-0000000000aa'::uuid,
  ARRAY[
    '9c000000-0000-0000-0000-000000000004'::uuid,
    '9c000000-0000-0000-0000-000000000005'::uuid
  ]
) AS result;

SELECT isnt(
  (SELECT result FROM task9h_copy_result),
  'raised',
  'C: an authorized, mixed clean/colliding call succeeds rather than raising'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004'),
  1,
  'C: T4 (clean target) now has exactly one new role'
);
SELECT is(
  (SELECT name FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004' LIMIT 1),
  'Task 9h Source Role',
  'C: the cloned role in T4 has the source role''s name'
);
SELECT is(
  (SELECT description FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004' LIMIT 1),
  'pgTAP fixture — role to be copied',
  'C: the cloned role in T4 has the source role''s description'
);
SELECT is(
  (SELECT flavor FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004' LIMIT 1),
  'collaborator',
  'C: the cloned role in T4 has the source role''s flavor'
);
SELECT is(
  (SELECT builtin FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000004' LIMIT 1),
  false,
  'C: the cloned role in T4 is not builtin'
);
SELECT is(
  (
    SELECT count(*)::int FROM public.role_areas ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE r.restaurant_id = '9c000000-0000-0000-0000-000000000004'
  ),
  2,
  'C: the cloned role in T4 has both source role_areas rows'
);
SELECT is(
  (
    SELECT level FROM public.role_areas ra
    JOIN public.roles r ON r.id = ra.role_id
    WHERE r.restaurant_id = '9c000000-0000-0000-0000-000000000004' AND ra.area_key = 'scheduling'
  ),
  'manage',
  'C: the cloned role_areas row for scheduling keeps the source level (manage)'
);
SELECT is(
  (
    SELECT count(*)::int FROM public.role_flags rf
    JOIN public.roles r ON r.id = rf.role_id
    WHERE r.restaurant_id = '9c000000-0000-0000-0000-000000000004'
  ),
  1,
  'C: the cloned role in T4 has the source role_flags row'
);
SELECT is(
  (
    SELECT flag FROM public.role_flags rf
    JOIN public.roles r ON r.id = rf.role_id
    WHERE r.restaurant_id = '9c000000-0000-0000-0000-000000000004'
  ),
  'view:costs',
  'C: the cloned role_flags row is view:costs'
);
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000005'),
  1,
  'C: T5 (colliding target) still has exactly its one pre-existing role -- no new row was inserted'
);
SELECT ok(
  (SELECT result FROM task9h_copy_result) LIKE '%9c000000-0000-0000-0000-000000000004%',
  'C: the returned result reports T4 as copied'
);
SELECT ok(
  (SELECT result FROM task9h_copy_result) LIKE '%9c000000-0000-0000-0000-000000000005%'
  AND (SELECT result FROM task9h_copy_result) LIKE '%Task 9h Source Role%',
  'C: the returned result reports T5''s name collision back, rather than silently suffixing'
);

DROP TABLE task9h_copy_result;

-- ============================================================================
-- D. A builtin role cannot be used as the copy source, even for an
--    authorized caller.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000006'),
  0,
  'D: pre-count — T6 has zero roles before the builtin-source call'
);

SELECT is(
  pg_temp.as_user_copy(
    '9c000000-0000-0000-0000-0000000000b4'::uuid,
    'b0000000-0000-0000-0000-000000000001'::uuid, -- seeded builtin "Owner"
    ARRAY['9c000000-0000-0000-0000-000000000006'::uuid]
  ),
  'raised',
  'D: copying a builtin role is rejected even for an otherwise-authorized caller'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000006'),
  0,
  'D: post-count — T6 still has zero roles'
);

-- ============================================================================
-- E. A nonexistent source role_id raises rather than silently no-op'ing.
-- ============================================================================
SELECT is(
  pg_temp.as_user_copy(
    '9c000000-0000-0000-0000-0000000000b4'::uuid,
    '9c000000-0000-0000-0000-00000000dead'::uuid,
    ARRAY['9c000000-0000-0000-0000-000000000006'::uuid]
  ),
  'raised',
  'E: a nonexistent source role_id is rejected'
);

-- ============================================================================
-- F. Source gate. userE holds manage:collaborators in T7 (legacy 'owner')
--    but is not a member of the source restaurant S at all. Without the
--    source check this call would succeed and hand userE the full contents
--    of another tenant's role — the RPC would be a cross-tenant read
--    dressed up as a write. Counted before and after, like every other
--    denial in this file.
-- ============================================================================
SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000007'),
  0,
  'F: pre-count — T7 has zero roles before the foreign-source call'
);

SELECT is(
  pg_temp.as_user_copy(
    '9c000000-0000-0000-0000-0000000000b5'::uuid,
    '9c000000-0000-0000-0000-0000000000aa'::uuid,
    ARRAY['9c000000-0000-0000-0000-000000000007'::uuid]
  ),
  'raised',
  'F: a caller authorized in the target but not a member of the source restaurant is denied'
);

SELECT is(
  (SELECT count(*)::int FROM public.roles WHERE restaurant_id = '9c000000-0000-0000-0000-000000000007'),
  0,
  'F: post-count — T7 still has zero roles, no foreign role was cloned in'
);

SELECT * FROM finish();
ROLLBACK;
