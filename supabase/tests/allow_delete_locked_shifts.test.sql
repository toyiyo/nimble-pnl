-- Test: delete_shift_series with p_include_locked parameter
-- Verifies default behavior skips locked shifts, and p_include_locked=true deletes them

BEGIN;

SELECT plan(8);

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
-- ============================================================

-- Create a parent shift (unlocked) and children (mix of locked/unlocked)
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000810'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-14 09:00:00+00', '2026-04-14 17:00:00+00', 'Server', false, NULL),
  ('00000000-0000-0000-0000-000000000811'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-15 09:00:00+00', '2026-04-15 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000810'::uuid),
  ('00000000-0000-0000-0000-000000000812'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-16 09:00:00+00', '2026-04-16 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000810'::uuid),
  ('00000000-0000-0000-0000-000000000813'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-17 09:00:00+00', '2026-04-17 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000810'::uuid);

-- Test 1: Default (p_include_locked=false) with scope='all' should only delete unlocked
SELECT is(
  (SELECT deleted_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000810'::uuid,
    :rest_id::uuid,
    'all'
  )),
  2,
  'Default scope=all: should delete 2 unlocked shifts'
);

-- Test 2: Default should report 2 locked shifts remaining
SELECT is(
  (SELECT locked_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000810'::uuid,
    :rest_id::uuid,
    'all'
  )),
  2,
  'Default scope=all: should report 2 locked shifts'
);

-- Test 3: Verify locked shifts still exist in DB
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE recurrence_parent_id = '00000000-0000-0000-0000-000000000810'::uuid
     AND restaurant_id = :rest_id::uuid
     AND locked = true),
  2,
  'Locked shifts should still exist after default delete'
);

-- ============================================================
-- Test Group 2: p_include_locked = true with scope='all'
-- ============================================================

-- Create a new series for this test
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, locked, recurrence_parent_id)
VALUES
  ('00000000-0000-0000-0000-000000000820'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-21 09:00:00+00', '2026-04-21 17:00:00+00', 'Server', false, NULL),
  ('00000000-0000-0000-0000-000000000821'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-22 09:00:00+00', '2026-04-22 17:00:00+00', 'Server', false,
   '00000000-0000-0000-0000-000000000820'::uuid),
  ('00000000-0000-0000-0000-000000000822'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-23 09:00:00+00', '2026-04-23 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000820'::uuid),
  ('00000000-0000-0000-0000-000000000823'::uuid, :rest_id::uuid, :emp_id::uuid,
   '2026-04-24 09:00:00+00', '2026-04-24 17:00:00+00', 'Server', true,
   '00000000-0000-0000-0000-000000000820'::uuid);

-- Test 4: p_include_locked=true with scope='all' should delete all 4 shifts
SELECT is(
  (SELECT deleted_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000820'::uuid,
    :rest_id::uuid,
    'all',
    NULL,
    true
  )),
  4,
  'p_include_locked=true scope=all: should delete all 4 shifts'
);

-- Test 5: locked_count should be 0 when force-deleting
SELECT is(
  (SELECT locked_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000820'::uuid,
    :rest_id::uuid,
    'all',
    NULL,
    true
  )),
  0,
  'p_include_locked=true scope=all: locked_count should be 0'
);

-- Test 6: Verify no shifts remain
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE (id = '00000000-0000-0000-0000-000000000820'::uuid
     OR recurrence_parent_id = '00000000-0000-0000-0000-000000000820'::uuid)
     AND restaurant_id = :rest_id::uuid),
  0,
  'No shifts should remain after force delete'
);

-- ============================================================
-- Test Group 3: p_include_locked = true with scope='following'
-- ============================================================

-- Create a new series for following-scope test
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

-- Test 7: p_include_locked=true, scope='following' from Apr 29 should delete 2 shifts
SELECT is(
  (SELECT deleted_count FROM delete_shift_series(
    '00000000-0000-0000-0000-000000000830'::uuid,
    :rest_id::uuid,
    'following',
    '2026-04-29 00:00:00+00'::timestamptz,
    true
  )),
  2,
  'p_include_locked=true scope=following: should delete 2 shifts from cutoff'
);

-- Test 8: The parent shift before cutoff should still exist
SELECT is(
  (SELECT COUNT(*)::int FROM shifts
   WHERE id = '00000000-0000-0000-0000-000000000830'::uuid
     AND restaurant_id = :rest_id::uuid),
  1,
  'Parent shift before cutoff should still exist'
);

SELECT * FROM finish();
ROLLBACK;
