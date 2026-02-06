-- pgTAP tests for shift series operations RPC functions
-- Tests: delete_shift_series, update_shift_series, get_shift_series_info

BEGIN;

SELECT plan(18);

-- Setup: Create test data
INSERT INTO restaurants (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, email, position, status, is_active)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Test Employee', 'test@example.com', 'Server', 'active', true)
ON CONFLICT (id) DO NOTHING;

-- Create a parent shift and its children for testing
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, status, is_recurring, recurrence_parent_id, locked)
VALUES
  -- Parent shift
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-01-10 09:00:00+00', '2026-01-10 17:00:00+00', 'Server', 'scheduled', true, NULL, false),
  -- Child shifts (unlocked)
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-01-11 09:00:00+00', '2026-01-11 17:00:00+00', 'Server', 'scheduled', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-01-12 09:00:00+00', '2026-01-12 17:00:00+00', 'Server', 'scheduled', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', false),
  -- Child shift (locked)
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-01-13 09:00:00+00', '2026-01-13 17:00:00+00', 'Server', 'scheduled', true, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Tests for get_shift_series_info
-- ============================================

-- Test 1: get_shift_series_info returns correct counts
SELECT results_eq(
  $$SELECT series_count, locked_count FROM get_shift_series_info(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  )$$,
  $$VALUES (4::int, 1::int)$$,
  'get_shift_series_info returns correct series_count and locked_count'
);

-- Test 2: get_shift_series_info with non-existent parent returns zeros
SELECT results_eq(
  $$SELECT series_count, locked_count FROM get_shift_series_info(
    '99999999-9999-9999-9999-999999999999'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid
  )$$,
  $$VALUES (0::int, 0::int)$$,
  'get_shift_series_info returns zeros for non-existent parent'
);

-- ============================================
-- Tests for update_shift_series
-- ============================================

-- Test 3: update_shift_series 'all' scope updates all unlocked shifts
SELECT results_eq(
  $$SELECT updated_count, locked_count FROM update_shift_series(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'all',
    '{"position": "Host"}'::jsonb,
    NULL
  )$$,
  $$VALUES (3::int, 1::int)$$,
  'update_shift_series all scope returns correct counts'
);

-- Test 4: Verify the position was actually updated
SELECT is(
  (SELECT position FROM shifts WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Host',
  'update_shift_series actually updated the position'
);

-- Test 5: Verify locked shift was NOT updated
SELECT is(
  (SELECT position FROM shifts WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
  'Server',
  'update_shift_series did not update locked shift'
);

-- Reset positions for further tests
UPDATE shifts SET position = 'Server' WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';

-- Test 6: update_shift_series 'following' scope only updates shifts from given time
SELECT results_eq(
  $$SELECT updated_count, locked_count FROM update_shift_series(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'following',
    '{"position": "Bartender"}'::jsonb,
    '2026-01-12 00:00:00+00'::timestamptz
  )$$,
  $$VALUES (1::int, 1::int)$$,
  'update_shift_series following scope returns correct counts'
);

-- Test 7: Verify only shifts from that time were updated
SELECT is(
  (SELECT position FROM shifts WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'Server',
  'update_shift_series following scope did not update earlier shift'
);

SELECT is(
  (SELECT position FROM shifts WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'Bartender',
  'update_shift_series following scope updated the target shift'
);

-- ============================================
-- Tests for delete_shift_series
-- ============================================

-- Test 9-12: delete_shift_series 'following' scope (with fresh data)
DELETE FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, status, is_recurring, recurrence_parent_id, locked)
VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-02-10 09:00:00+00', '2026-02-10 17:00:00+00', 'Server', 'scheduled', true, NULL, false),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-02-11 09:00:00+00', '2026-02-11 17:00:00+00', 'Server', 'scheduled', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false),
  ('11111111-2222-3333-4444-555555555555', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-02-12 09:00:00+00', '2026-02-12 17:00:00+00', 'Server', 'scheduled', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', false),
  ('11111111-2222-3333-4444-666666666666', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-02-13 09:00:00+00', '2026-02-13 17:00:00+00', 'Server', 'scheduled', true, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

-- Test 9: delete_shift_series 'following' scope
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'following',
    '2026-02-12 00:00:00+00'::timestamptz
  )$$,
  $$VALUES (1::int, 1::int)$$,
  'delete_shift_series following scope returns correct counts'
);

-- Test 10: Verify earlier shifts still exist
SELECT ok(
  EXISTS(SELECT 1 FROM shifts WHERE id = 'ffffffff-ffff-ffff-ffff-ffffffffffff'),
  'delete_shift_series following scope preserved earlier shift'
);

-- Test 11: Verify target shift was deleted
SELECT ok(
  NOT EXISTS(SELECT 1 FROM shifts WHERE id = '11111111-2222-3333-4444-555555555555'),
  'delete_shift_series following scope deleted target shift'
);

-- Test 12: Verify locked shift was preserved (after 'following' delete)
SELECT ok(
  EXISTS(SELECT 1 FROM shifts WHERE id = '11111111-2222-3333-4444-666666666666'),
  'delete_shift_series following scope preserved locked shift'
);

-- Test 13-15: delete_shift_series 'all' scope (with FRESH data to isolate from previous tests)
DELETE FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';

INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, status, is_recurring, recurrence_parent_id, locked)
VALUES
  ('77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-03-10 09:00:00+00', '2026-03-10 17:00:00+00', 'Server', 'scheduled', true, NULL, false),
  ('88888888-8888-8888-8888-888888888888', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-03-11 09:00:00+00', '2026-03-11 17:00:00+00', 'Server', 'scheduled', true, '77777777-7777-7777-7777-777777777777', false),
  ('99999999-9999-9999-9999-999999999999', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-03-12 09:00:00+00', '2026-03-12 17:00:00+00', 'Server', 'scheduled', true, '77777777-7777-7777-7777-777777777777', true);

-- Test 13: Verify locked shift was inserted correctly BEFORE delete
SELECT ok(
  EXISTS(SELECT 1 FROM shifts WHERE id = '99999999-9999-9999-9999-999999999999' AND locked = true),
  'Locked shift exists with locked=true before delete_shift_series'
);

-- Test 14: delete_shift_series 'all' scope
SELECT results_eq(
  $$SELECT deleted_count, locked_count FROM delete_shift_series(
    '77777777-7777-7777-7777-777777777777'::uuid,
    '11111111-1111-1111-1111-111111111111'::uuid,
    'all',
    NULL
  )$$,
  $$VALUES (2::int, 1::int)$$,
  'delete_shift_series all scope returns correct counts'
);

-- Test 15: Verify all unlocked shifts are deleted
SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND locked = false)::int,
  0,
  'delete_shift_series all scope deleted all unlocked shifts'
);

-- Test 16: Verify locked shift still exists
SELECT ok(
  EXISTS(SELECT 1 FROM shifts WHERE id = '99999999-9999-9999-9999-999999999999'),
  'delete_shift_series all scope preserved locked shift'
);

-- Test 17-18: Direct DELETE test to verify basic behavior (bypassing function)
DELETE FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, position, status, is_recurring, recurrence_parent_id, locked)
VALUES
  ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-04-10 09:00:00+00', '2026-04-10 17:00:00+00', 'Server', 'scheduled', true, NULL, false),
  ('aaaaaaaa-bbbb-cccc-dddd-ffffffffffff', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222',
   '2026-04-11 09:00:00+00', '2026-04-11 17:00:00+00', 'Server', 'scheduled', true, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', true);

-- Direct DELETE that should only affect unlocked shifts
DELETE FROM shifts
WHERE restaurant_id = '11111111-1111-1111-1111-111111111111'
  AND locked = false;

-- Test 17: Verify direct DELETE only deleted unlocked shift
SELECT is(
  (SELECT COUNT(*) FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111')::int,
  1,
  'Direct DELETE with locked=false only deleted 1 shift (preserved locked)'
);

-- Test 18: Verify the remaining shift is the locked one
SELECT ok(
  EXISTS(SELECT 1 FROM shifts WHERE id = 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff' AND locked = true),
  'Direct DELETE preserved the locked shift'
);

-- Cleanup
DELETE FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';
DELETE FROM employees WHERE id = '22222222-2222-2222-2222-222222222222';
DELETE FROM restaurants WHERE id = '11111111-1111-1111-1111-111111111111';

SELECT * FROM finish();

ROLLBACK;
