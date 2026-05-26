-- pgTAP tests for the employee_compensation_history → employees relationship
-- consumed by ai-execute-tool's PostgREST embed
-- `compensation_history:employee_compensation_history(*)`.
--
-- Two contracts are pinned here:
--   1. The FK exists. Without it, PostgREST cannot resolve the embed and the
--      query silently returns null (or, if the column name happens to overlap
--      a real column on `employees`, returns the wrong thing).
--   2. RLS is asymmetric in the safe direction: owner + manager can read
--      compensation history; staff cannot. This pins the
--      20260526120000_tighten_compensation_history_select_rls migration.

BEGIN;
SELECT plan(7);

SET LOCAL role TO postgres;

-- Fixture setup: disable RLS for inserts, then re-enable for the role-gated
-- assertions below.
ALTER TABLE public.restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_compensation_history DISABLE ROW LEVEL SECURITY;

-- 1. Table + FK exist (the embed cannot resolve without them).
SELECT has_table('public', 'employee_compensation_history',
  'employee_compensation_history table exists');

SELECT col_is_fk('public', 'employee_compensation_history', 'employee_id',
  'employee_id is a foreign key (PostgREST can resolve the embed)');

-- Fixture: one restaurant, three users (owner/manager/staff), one employee,
-- two compensation history rows.
DELETE FROM public.employee_compensation_history WHERE restaurant_id = '00000000-0000-0000-0000-0000000000ec'::uuid;
DELETE FROM public.employees WHERE restaurant_id = '00000000-0000-0000-0000-0000000000ec'::uuid;
DELETE FROM public.user_restaurants WHERE restaurant_id = '00000000-0000-0000-0000-0000000000ec'::uuid;
DELETE FROM public.restaurants WHERE id = '00000000-0000-0000-0000-0000000000ec'::uuid;

-- Seed auth.users so the user_restaurants FK is satisfied. ON CONFLICT
-- preserves cross-test isolation: other test files may have already inserted
-- these UUIDs against different emails.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000e1'::uuid, 'owner-ech@test.com'),
  ('00000000-0000-0000-0000-0000000000e2'::uuid, 'manager-ech@test.com'),
  ('00000000-0000-0000-0000-0000000000e3'::uuid, 'staff-ech@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (id, name)
VALUES ('00000000-0000-0000-0000-0000000000ec'::uuid, 'Test Restaurant ECH');

INSERT INTO public.user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-0000000000e1'::uuid, '00000000-0000-0000-0000-0000000000ec'::uuid, 'owner'),
  ('00000000-0000-0000-0000-0000000000e2'::uuid, '00000000-0000-0000-0000-0000000000ec'::uuid, 'manager'),
  ('00000000-0000-0000-0000-0000000000e3'::uuid, '00000000-0000-0000-0000-0000000000ec'::uuid, 'staff');

INSERT INTO public.employees (
  id, restaurant_id, name, position, status, compensation_type, hourly_rate, is_active
)
VALUES (
  '00000000-0000-0000-0000-0000000000ed'::uuid,
  '00000000-0000-0000-0000-0000000000ec'::uuid,
  'Comp History Test Employee',
  'Server',
  'active',
  'hourly',
  1500,
  TRUE
);

INSERT INTO public.employee_compensation_history (
  employee_id, restaurant_id, compensation_type, amount_cents, effective_date
) VALUES
  ('00000000-0000-0000-0000-0000000000ed'::uuid,
   '00000000-0000-0000-0000-0000000000ec'::uuid,
   'hourly', 1500, '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000ed'::uuid,
   '00000000-0000-0000-0000-0000000000ec'::uuid,
   'hourly', 1700, '2026-04-01');

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_compensation_history ENABLE ROW LEVEL SECURITY;

-- 3. Owner can read both compensation history rows.
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT COUNT(*)::int
     FROM public.employee_compensation_history
    WHERE employee_id = '00000000-0000-0000-0000-0000000000ed'::uuid),
  2,
  'owner can read both compensation history rows'
);

-- 4. Manager can read both compensation history rows.
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT COUNT(*)::int
     FROM public.employee_compensation_history
    WHERE employee_id = '00000000-0000-0000-0000-0000000000ed'::uuid),
  2,
  'manager can read both compensation history rows'
);

-- 5. Staff cannot read any compensation history rows (post-RLS-tighten).
SET LOCAL role TO authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e3', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT is(
  (SELECT COUNT(*)::int
     FROM public.employee_compensation_history
    WHERE employee_id = '00000000-0000-0000-0000-0000000000ed'::uuid),
  0,
  'staff cannot read compensation history rows (RLS gates by role)'
);

-- 6. Anonymous (no JWT) cannot read any compensation history rows.
SET LOCAL role TO anon;
SELECT set_config('request.jwt.claims', NULL, true);
SELECT set_config('request.jwt.claim.sub', NULL, true);
SELECT set_config('request.jwt.claim.role', NULL, true);

SELECT is(
  (SELECT COUNT(*)::int
     FROM public.employee_compensation_history
    WHERE employee_id = '00000000-0000-0000-0000-0000000000ed'::uuid),
  0,
  'anonymous role cannot read compensation history rows'
);

-- 7. The currently-installed policy mentions owner/manager — pins the migration.
SET LOCAL role TO postgres;
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_compensation_history'
      AND cmd = 'SELECT'
      AND qual ILIKE '%''owner''%'
      AND qual ILIKE '%''manager''%'
  ),
  'SELECT policy restricts read access to owner and manager roles'
);

SELECT * FROM finish();
ROLLBACK;
