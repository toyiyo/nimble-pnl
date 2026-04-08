-- Test: delete_shift_series with p_include_locked parameter
-- Verifies default behavior skips locked shifts, and p_include_locked=true deletes them

BEGIN;

SELECT plan(6);

-- Setup: Create test restaurant, user, and employee
INSERT INTO restaurants (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-000000000801'::uuid, 'Lock Test Restaurant', '123 Lock St', '555-LOCK')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000802'::uuid, 'lock-test@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('00000000-0000-0000-0000-000000000803'::uuid,
        '00000000-0000-0000-0000-000000000801'::uuid,
        'Lock Test Employee', 'Server', 1500)
ON CONFLICT (id) DO NOTHING;

-- Helper variables
\set rest_id '''00000000-0000-0000-0000-000000000801'''
\set emp_id '''00000000-0000-0000-0000-000000000803'''

-- ============================================================
-- Test Group 1: Default behavior (p_include_locked = false)
-- Parent is locked, one child unlocked, one child locked
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000810'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-14 09:00:00+00', '2026-04-14 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000811'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-15 09:00:00+00', '2026-04-15 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000810'::uuid),
  ('00000000-0000-0000-0000-000000000812'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-16 09:00:00+00', '2026-04-16 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000810'::uuid);

-- Test 1: Default deletes only the 1 unlocked child, reports 2 locked (parent + child)
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000810'::uuid,
    '00000000-0000-0000-0000-000000000801'::uuid,
    'all'
  )$$,
  $$VALUES (1, 2)$$,
  'Default scope=all: deletes 1 unlocked, reports 2 locked'
);

-- Test 2: Verify 2 locked shifts still exist after default delete
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE (id = '00000000-0000-0000-0000-000000000810'::uuid
     OR recurrence_parent_id = '00000000-0000-0000-0000-000000000810'::uuid)
     AND restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid
     AND locked = true),
  2,
  'Locked shifts should still exist after default delete'
);

-- ============================================================
-- Test Group 2: p_include_locked = true with scope='all'
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000820'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-21 09:00:00+00', '2026-04-21 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000821'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-22 09:00:00+00', '2026-04-22 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000820'::uuid),
  ('00000000-0000-0000-0000-000000000822'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-23 09:00:00+00', '2026-04-23 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000820'::uuid);

-- Test 3: p_include_locked=true deletes all 3 shifts, reports 0 locked
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000820'::uuid,
    '00000000-0000-0000-0000-000000000801'::uuid,
    'all',
    NULL,
    true
  )$$,
  $$VALUES (3, 0)$$,
  'p_include_locked=true scope=all: deletes all 3, locked_count=0'
);

-- Test 4: Verify no shifts remain
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE (id = '00000000-0000-0000-0000-000000000820'::uuid
     OR recurrence_parent_id = '00000000-0000-0000-0000-000000000820'::uuid)
     AND restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid),
  0,
  'No shifts should remain after force delete'
);

-- ============================================================
-- Test Group 3: p_include_locked = true with scope='following'
-- ============================================================

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000830'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-28 09:00:00+00', '2026-04-28 17:00:00+00', 'Server', true, NULL),
  ('00000000-0000-0000-0000-000000000831'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-29 09:00:00+00', '2026-04-29 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000830'::uuid),
  ('00000000-0000-0000-0000-000000000832'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-30 09:00:00+00', '2026-04-30 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000830'::uuid);

-- Test 5: p_include_locked=true, scope='following' from Apr 29 deletes 2 shifts
SELECT is(
  (SELECT deleted_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000830'::uuid,
    '00000000-0000-0000-0000-000000000801'::uuid,
    'following',
    '2026-04-29 00:00:00+00'::timestamptz,
    true
  )),
  2,
  'p_include_locked=true scope=following: deletes 2 shifts from cutoff'
);

-- Test 6: Parent shift before cutoff still exists
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE id = '00000000-0000-0000-0000-000000000830'::uuid
     AND restaurant_id = '00000000-0000-0000-0000-000000000801'::uuid),
  1,
  'Parent shift before cutoff should still exist'
);

SELECT * FROM finish();
ROLLBACK;
