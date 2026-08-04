-- ============================================================================
-- replace_role_grants_test.sql
--
-- Coverage for the replace_role_grants RPC
-- (20260730190000_replace_role_grants.sql), which exists so that saving a
-- role's areas and flags is one transaction instead of four independent
-- round-trips from the browser. The test that matters is section 5: a call
-- whose area list is rejected by the collaborator cap must leave the role's
-- previous grants exactly as they were. Under the old client-side
-- delete-then-insert the deletes had already committed by then, and the role
-- was left with nothing.
--
-- One honest limit on section 5/6: pgTAP's throws_ok runs its statement in a
-- plpgsql exception block, which is a subtransaction, so *any* failing
-- statement rolls back inside this file — the four-round-trips-over-HTTP
-- shape that produced the bug cannot be reproduced from SQL at all. What
-- these assertions do guard is the property the fix depends on and that a
-- later edit could quietly remove: the whole replacement is one server-side
-- statement whose failure is not swallowed (an `EXCEPTION WHEN OTHERS` added
-- to the function body, or a split into separate calls, would fail here).
--
-- The rest of the file pins the properties the RPC is relying on rather than
-- re-implementing: it is SECURITY INVOKER, so the caller's own RLS policies
-- and the builtin-mutation block still gate every statement in the body. A
-- DEFINER version would silently drop all three gates, so section 1 asserts
-- the flag directly rather than trusting the migration text.
--
-- All fixture data below is fictional and exists only for the duration of
-- this transaction (ROLLBACK).
-- ============================================================================
BEGIN;

SELECT plan(12);

-- ----------------------------------------------------------------------------
-- Fixtures: one restaurant, an owner (holds manage:collaborators) and a staff
-- member (does not), one custom collaborator-flavored role carrying two areas
-- and one flag, and one builtin role carrying an area of its own.
-- ----------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'replace-grants-owner@example.test'),
  ('c1000000-0000-0000-0000-000000000002', 'replace-grants-staff@example.test');

INSERT INTO public.restaurants (id, name) VALUES
  ('c1000000-0000-0000-0000-0000000000a1', 'Replace Grants Test Restaurant');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('c1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-0000000000a1', 'owner'),
  ('c1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-0000000000a1', 'staff');

INSERT INTO public.roles (id, restaurant_id, name, flavor, builtin) VALUES
  ('c1000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-0000000000a1',
   'Replace Grants Custom Role', 'collaborator', false),
  -- Named distinctly from the ten builtins seeded by
  -- 20260730110000_seed_builtin_roles.sql so it cannot collide with
  -- uq_roles_global_name_ci.
  ('c1000000-0000-0000-0000-0000000000b1', NULL,
   'Replace Grants QA Builtin', 'platform', true);

INSERT INTO public.role_areas (role_id, area_key, level) VALUES
  ('c1000000-0000-0000-0000-0000000000c1', 'scheduling', 'manage'),
  ('c1000000-0000-0000-0000-0000000000c1', 'payroll',    'view'),
  ('c1000000-0000-0000-0000-0000000000b1', 'team',       'manage');

INSERT INTO public.role_flags (role_id, flag) VALUES
  ('c1000000-0000-0000-0000-0000000000c1', 'view:pay_rates');

-- ============================================================================
-- 1. SECURITY INVOKER, not DEFINER. Every gate this RPC leans on — the
--    role_areas/role_flags RLS policies, block_builtin_role_child_mutation,
--    role_areas_enforce_collaborator_cap — applies to the *caller*. Flip this
--    flag and the function silently becomes a way to write any role in any
--    restaurant, so it is asserted rather than assumed.
-- ============================================================================
SELECT is(
  (SELECT p.prosecdef
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'replace_role_grants'),
  FALSE,
  'replace_role_grants is SECURITY INVOKER, so the caller''s RLS and the area cap still apply'
);

-- ============================================================================
-- 2. Denied baseline first: staff holds no manage:collaborators, so the RLS
--    policies reject the write. (The DELETEs are merely filtered to zero rows
--    — RLS does not raise on DELETE — and the INSERT is what raises.)
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000002","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.replace_role_grants(
       'c1000000-0000-0000-0000-0000000000c1',
       '[{"area_key":"inventory","level":"manage"}]'::jsonb,
       ARRAY[]::text[]) $$,
  '42501', NULL,
  'staff (no manage:collaborators) cannot replace a role''s grants'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 3. ...and that denial changed nothing. Without this the test above would
--    also pass against a function that deleted everything and then raised.
-- ============================================================================
SELECT is(
  (SELECT array_agg(area_key || ':' || level ORDER BY area_key)
     FROM public.role_areas WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1'),
  ARRAY['payroll:view', 'scheduling:manage'],
  'the denied call left the role''s existing areas untouched'
);

-- ============================================================================
-- 4. The owner can replace the grants, and it is a replacement: the previous
--    areas and the previous flag are gone, not merged with the new ones.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT lives_ok(
  $$ SELECT public.replace_role_grants(
       'c1000000-0000-0000-0000-0000000000c1',
       '[{"area_key":"inventory","level":"manage"},{"area_key":"reports","level":"view"}]'::jsonb,
       ARRAY['view:costs']::text[]) $$,
  'owner (manage:collaborators holder) can replace a custom role''s grants'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT is(
  (SELECT array_agg(area_key || ':' || level ORDER BY area_key)
     FROM public.role_areas WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1'),
  ARRAY['inventory:manage', 'reports:view'],
  'the areas are replaced wholesale — scheduling and payroll are gone, not merged'
);

SELECT is(
  (SELECT array_agg(flag ORDER BY flag)
     FROM public.role_flags WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1'),
  ARRAY['view:costs'],
  'the flags are replaced wholesale — view:pay_rates is gone, not merged'
);

-- ============================================================================
-- 5. The reason this function exists. The area list below is half legal
--    (recipes) and half not: Team & Access has a NULL collaborator cap, so
--    role_areas_enforce_collaborator_cap rejects it. The call must raise...
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.replace_role_grants(
       'c1000000-0000-0000-0000-0000000000c1',
       '[{"area_key":"recipes","level":"manage"},{"area_key":"team","level":"manage"}]'::jsonb,
       ARRAY['view:employee_pii']::text[]) $$,
  '42501', NULL,
  'the collaborator cap still rejects Team & Access when the grant arrives through the RPC'
);

RESET ROLE;
RESET request.jwt.claims;

-- ============================================================================
-- 6. ...and roll the whole call back. These three assertions are the
--    regression guard for the bug: the deletes and the legal `recipes` insert
--    must both be undone, leaving section 4's grants exactly as they were.
--    Under the old four-round-trip client code the role would be sitting at
--    zero areas and zero flags right now, locking out everyone assigned it.
-- ============================================================================
SELECT is(
  (SELECT array_agg(area_key || ':' || level ORDER BY area_key)
     FROM public.role_areas WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1'),
  ARRAY['inventory:manage', 'reports:view'],
  'a rejected area rolls the deletes back — the role keeps the areas it had'
);

SELECT is(
  (SELECT array_agg(flag ORDER BY flag)
     FROM public.role_flags WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1'),
  ARRAY['view:costs'],
  'a rejected area rolls the flag replacement back too — both tables move together'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.role_areas
     WHERE role_id = 'c1000000-0000-0000-0000-0000000000c1' AND area_key = 'recipes'
  ),
  'the legal half of the rejected batch is not left behind either'
);

-- ============================================================================
-- 7. A builtin role's grants cannot be replaced through the RPC. Two gates
--    stand in the way and either one is enough: the RLS policies scope both
--    tables to a restaurant the caller administers and builtins are global
--    (restaurant_id IS NULL), and block_builtin_role_child_mutation rejects
--    the DELETE outright for any writer that does get past RLS.
-- ============================================================================
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"c1000000-0000-0000-0000-000000000001","role":"authenticated"}';

SELECT throws_ok(
  $$ SELECT public.replace_role_grants(
       'c1000000-0000-0000-0000-0000000000b1',
       '[{"area_key":"inventory","level":"manage"}]'::jsonb,
       ARRAY[]::text[]) $$,
  '42501', NULL,
  'owner cannot replace a builtin role''s grants through the RPC'
);

RESET ROLE;
RESET request.jwt.claims;

SELECT is(
  (SELECT array_agg(area_key || ':' || level ORDER BY area_key)
     FROM public.role_areas WHERE role_id = 'c1000000-0000-0000-0000-0000000000b1'),
  ARRAY['team:manage'],
  'the builtin still holds the area it was seeded with'
);

SELECT * FROM finish();
ROLLBACK;
