-- Test: update_shift_series with p_include_locked parameter
-- Verifies default behavior skips locked shifts, and p_include_locked=true updates them

BEGIN;

SELECT plan(7);

-- Setup: Create test restaurant, user, and employee
INSERT INTO restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-000000000901'::uuid, 'Series Update Lock Test Restaurant', '123 Lock St', '555-LOCK')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000902'::uuid, 'series-lock-test@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('00000000-0000-0000-0000-000000000903'::uuid,
        '00000000-0000-0000-0000-000000000901'::uuid,
        'Series Lock Test Employee', 'Server', 1500)
ON CONFLICT (id) DO NOTHING;

\set rest_id '''00000000-0000-0000-0000-000000000901'''
\set emp_id '''00000000-0000-0000-0000-000000000903'''

-- The function is SECURITY DEFINER and checks user_has_capability itself,
-- so every call below needs an authenticated owner of the restaurant.
INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-000000000902'::uuid,
        '00000000-0000-0000-0000-000000000901'::uuid, 'owner')
ON CONFLICT DO NOTHING;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000902","role":"authenticated"}', true);

-- ============================================================
-- Test Group 1: Default behavior (p_include_locked = false)
-- Parent is locked, one child unlocked, one child locked
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000910'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-14 09:00:00+00', '2026-04-14 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000911'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-15 09:00:00+00', '2026-04-15 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000910'::uuid),
  ('00000000-0000-0000-0000-000000000912'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-16 09:00:00+00', '2026-04-16 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000910'::uuid);

-- Test 1: Default updates only the 1 unlocked child, reports 2 locked (parent + child)
SELECT results_eq(
  $$SELECT updated_count, locked_count FROM update_shift_series(
    '00000000-0000-0000-0000-000000000910'::uuid,
    '00000000-0000-0000-0000-000000000901'::uuid,
    'all',
    '{"position": "Host"}'::jsonb
  )$$,
  $$VALUES (1, 2)$$,
  'Default scope=all: updates 1 unlocked, reports 2 locked'
);

-- Test 2: Verify the 2 locked shifts kept their original position
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE (id = '00000000-0000-0000-0000-000000000910'::uuid
     OR recurrence_parent_id = '00000000-0000-0000-0000-000000000910'::uuid)
     AND restaurant_id = '00000000-0000-0000-0000-000000000901'::uuid
     AND locked = true
     AND position = 'Server'),
  2,
  'Locked shifts should keep their original position after default update'
);

-- ============================================================
-- Test Group 2: p_include_locked = true with scope='all'
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000920'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-21 09:00:00+00', '2026-04-21 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000921'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-22 09:00:00+00', '2026-04-22 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000920'::uuid),
  ('00000000-0000-0000-0000-000000000922'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-23 09:00:00+00', '2026-04-23 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000920'::uuid);

-- Test 3: p_include_locked=true updates all 3 shifts, reports 0 locked
SELECT results_eq(
  $$SELECT updated_count, locked_count FROM update_shift_series(
    '00000000-0000-0000-0000-000000000920'::uuid,
    '00000000-0000-0000-0000-000000000901'::uuid,
    'all',
    '{"position": "Host"}'::jsonb,
    NULL,
    NULL,
    NULL,
    true
  )$$,
  $$VALUES (3, 0)$$,
  'p_include_locked=true scope=all: updates all 3, locked_count=0'
);

-- Test 4: Verify all 3 shifts now carry the new position
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE (id = '00000000-0000-0000-0000-000000000920'::uuid
     OR recurrence_parent_id = '00000000-0000-0000-0000-000000000920'::uuid)
     AND restaurant_id = '00000000-0000-0000-0000-000000000901'::uuid
     AND position = 'Host'),
  3,
  'All 3 shifts should have the new position after force update'
);

-- ============================================================
-- Test Group 3: p_include_locked = true with scope='following'
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000930'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-28 09:00:00+00', '2026-04-28 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000931'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-29 09:00:00+00', '2026-04-29 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000930'::uuid),
  ('00000000-0000-0000-0000-000000000932'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-30 09:00:00+00', '2026-04-30 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000930'::uuid);

-- Test 5: p_include_locked=true, scope='following' from Apr 29 updates 2 shifts with locked_count=0
SELECT results_eq(
  $$SELECT updated_count, locked_count FROM update_shift_series(
    '00000000-0000-0000-0000-000000000930'::uuid,
    '00000000-0000-0000-0000-000000000901'::uuid,
    'following',
    '{"position": "Host"}'::jsonb,
    '2026-04-29 00:00:00+00'::timestamptz,
    NULL,
    NULL,
    true
  )$$,
  $$VALUES (2, 0)$$,
  'p_include_locked=true scope=following: updates 2, locked_count=0'
);

-- ============================================================
-- Test Group 3: tenancy gate
-- ============================================================

-- Test 6: the function pins search_path (SECURITY DEFINER hardening)
SELECT ok(
  pg_get_functiondef('update_shift_series(UUID, UUID, TEXT, JSONB, TIMESTAMPTZ, INTERVAL, INTERVAL, BOOLEAN)'::regprocedure)
    LIKE '%search_path%',
  'update_shift_series pins search_path'
);

-- Test 7: a caller with no membership in the restaurant is refused
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000999","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT * FROM update_shift_series(
    '00000000-0000-0000-0000-000000000910'::uuid,
    '00000000-0000-0000-0000-000000000901'::uuid,
    'all',
    '{"position": "Host"}'::jsonb
  )$$,
  'Access denied: you cannot edit shifts for this restaurant',
  'update_shift_series refuses a caller outside the restaurant'
);

SELECT * FROM finish();
ROLLBACK;
