-- pgTAP tests for schedule_plan_templates RPCs
-- Tests: save_schedule_plan_template, apply_schedule_plan_template, delete_schedule_plan_template

BEGIN;

SELECT plan(19);

-- ============================================
-- Setup: disable RLS for test data creation
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_plan_templates DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Create test users
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@tmpltest.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('aaaaaaaa-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@tmpltest.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Template Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- Link owner user to restaurant
INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000010', 'aaaaaaaa-0000-0000-0000-000000000001', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO employees (id, restaurant_id, name, email, position, status, is_active)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'Alice', 'alice@test.com', 'Server', 'active', true),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'Bob',   'bob@test.com',   'Cook',   'active', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticate as the owner for all subsequent RPC calls
SET LOCAL "request.jwt.claims" TO '{"sub": "aaaaaaaa-0000-0000-0000-000000000010"}';

-- ============================================
-- save_schedule_plan_template — happy path
-- ============================================

-- Test 1: saving a valid template returns id, name, shift_count
SELECT ok(
  (
    SELECT (save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 1',
      jsonb_build_array(
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
          'start_time', '2026-04-07T09:00:00+00:00',
          'end_time',   '2026-04-07T17:00:00+00:00',
          'break_duration', 30,
          'position', 'Server'
        )
      )
    ))->>'name' = 'Week 1'
  ),
  'save_schedule_plan_template returns correct name'
);

-- Test 2: shift_count is accurate
SELECT is(
  (
    SELECT (save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 2',
      jsonb_build_array(
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
          'start_time', '2026-04-08T09:00:00+00:00',
          'end_time',   '2026-04-08T17:00:00+00:00',
          'break_duration', 30,
          'position', 'Server'
        ),
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000003',
          'start_time', '2026-04-08T10:00:00+00:00',
          'end_time',   '2026-04-08T18:00:00+00:00',
          'break_duration', 0,
          'position', 'Cook'
        )
      )
    ))->>'shift_count'
  ),
  '2',
  'save_schedule_plan_template returns correct shift_count'
);

-- Test 3: record is persisted in table
SELECT is(
  (SELECT count(*)::integer FROM schedule_plan_templates
   WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  2,
  'Two templates saved successfully to schedule_plan_templates'
);

-- ============================================
-- save_schedule_plan_template — empty shifts rejection
-- ============================================

-- Test 4: empty shifts array raises exception
SELECT throws_ok(
  $$SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Empty Template',
      '[]'::jsonb
    )$$,
  'P0001',
  'Cannot save an empty schedule template',
  'save_schedule_plan_template rejects empty shifts array'
);

-- ============================================
-- save_schedule_plan_template — 5-template limit
-- ============================================

-- Test 5: saving 3 more templates (to reach 5) succeeds
SELECT lives_ok(
  $$
    SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 3',
      jsonb_build_array(jsonb_build_object(
        'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
        'start_time', '2026-04-09T09:00:00+00:00',
        'end_time',   '2026-04-09T17:00:00+00:00',
        'break_duration', 30,
        'position', 'Server'
      ))
    );
    SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 4',
      jsonb_build_array(jsonb_build_object(
        'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
        'start_time', '2026-04-10T09:00:00+00:00',
        'end_time',   '2026-04-10T17:00:00+00:00',
        'break_duration', 30,
        'position', 'Server'
      ))
    );
    SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 5',
      jsonb_build_array(jsonb_build_object(
        'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
        'start_time', '2026-04-11T09:00:00+00:00',
        'end_time',   '2026-04-11T17:00:00+00:00',
        'break_duration', 30,
        'position', 'Server'
      ))
    )
  $$,
  'Saving up to 5 templates succeeds'
);

-- Test 6: 6th template raises limit exception
SELECT throws_ok(
  $$SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Week 6',
      jsonb_build_array(jsonb_build_object(
        'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
        'start_time', '2026-04-12T09:00:00+00:00',
        'end_time',   '2026-04-12T17:00:00+00:00',
        'break_duration', 30,
        'position', 'Server'
      ))
    )$$,
  'P0001',
  'Maximum of 5 schedule templates allowed. Delete one to save a new one.',
  'save_schedule_plan_template enforces 5-template limit'
);

-- ============================================
-- Authorization checks
-- ============================================

-- Test 7: unauthorized user cannot save a template
SET LOCAL "request.jwt.claims" TO '{"sub": "aaaaaaaa-0000-0000-0000-000000000011"}';

SELECT throws_ok(
  $$SELECT save_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      'Unauthorized Template',
      jsonb_build_array(jsonb_build_object(
        'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
        'start_time', '2026-04-13T09:00:00+00:00',
        'end_time',   '2026-04-13T17:00:00+00:00',
        'break_duration', 30,
        'position', 'Server'
      ))
    )$$,
  'P0001',
  'Not authorized',
  'save_schedule_plan_template blocks unauthorized user'
);

-- Test 8: unauthorized user cannot apply a template
SELECT throws_ok(
  $$SELECT apply_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '2026-05-01T00:00:00+00:00'::timestamptz,
      '2026-05-07T23:59:59+00:00'::timestamptz,
      '[]'::jsonb,
      'replace'
    )$$,
  'P0001',
  'Not authorized',
  'apply_schedule_plan_template blocks unauthorized user'
);

-- Test 9: unauthorized user cannot delete a template
SELECT throws_ok(
  $$SELECT delete_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '99999999-9999-9999-9999-999999999999'::uuid
    )$$,
  'P0001',
  'Not authorized',
  'delete_schedule_plan_template blocks unauthorized user'
);

-- Switch back to authorized user for remaining tests
SET LOCAL "request.jwt.claims" TO '{"sub": "aaaaaaaa-0000-0000-0000-000000000010"}';

-- ============================================
-- apply_schedule_plan_template — replace mode
-- ============================================

-- Pre-insert: one unlocked and one locked shift in the target week
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, locked)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002',
   '2026-04-14T09:00:00+00:00', '2026-04-14T17:00:00+00:00', 30, 'Server', 'scheduled', false),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000003',
   '2026-04-14T10:00:00+00:00', '2026-04-14T18:00:00+00:00', 0,  'Cook',   'scheduled', true)
ON CONFLICT (id) DO NOTHING;

-- Test 10: replace mode returns correct inserted_count
SELECT is(
  (
    SELECT (apply_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '2026-04-14T00:00:00+00:00'::timestamptz,
      '2026-04-20T23:59:59+00:00'::timestamptz,
      jsonb_build_array(
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
          'start_time',  '2026-04-15T09:00:00+00:00',
          'end_time',    '2026-04-15T17:00:00+00:00',
          'break_duration', 30,
          'position', 'Server'
        )
      ),
      'replace'
    ))->>'inserted_count'
  ),
  '1',
  'apply replace mode inserts the provided shifts'
);

-- Test 11: replace mode deleted the unlocked pre-existing shift
SELECT is(
  (SELECT count(*)::integer FROM shifts
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  0,
  'apply replace mode deletes unlocked shifts in target range'
);

-- Test 12: replace mode preserved the locked shift
SELECT is(
  (SELECT count(*)::integer FROM shifts
   WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002'),
  1,
  'apply replace mode preserves locked shifts'
);

-- ============================================
-- apply_schedule_plan_template — merge mode
-- ============================================

-- Pre-insert: an existing shift for Alice on Apr 22 (overlapping with the incoming shift)
INSERT INTO shifts (id, restaurant_id, employee_id, start_time, end_time, break_duration, position, status, locked)
VALUES
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002',
   '2026-04-22T09:00:00+00:00', '2026-04-22T17:00:00+00:00', 30, 'Server', 'scheduled', false)
ON CONFLICT (id) DO NOTHING;

-- Test 13: merge mode skips overlapping shifts (Alice already has one)
SELECT is(
  (
    SELECT (apply_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '2026-04-21T00:00:00+00:00'::timestamptz,
      '2026-04-27T23:59:59+00:00'::timestamptz,
      jsonb_build_array(
        -- overlapping for Alice
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
          'start_time',  '2026-04-22T10:00:00+00:00',
          'end_time',    '2026-04-22T16:00:00+00:00',
          'break_duration', 0,
          'position', 'Server'
        ),
        -- non-overlapping for Bob
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000003',
          'start_time',  '2026-04-22T10:00:00+00:00',
          'end_time',    '2026-04-22T18:00:00+00:00',
          'break_duration', 0,
          'position', 'Cook'
        )
      ),
      'merge'
    ))->>'inserted_count'
  ),
  '1',
  'apply merge mode inserts only non-overlapping shifts'
);

-- Test 14: merge mode skipped_count reflects the overlapping shift
SELECT is(
  (
    SELECT (apply_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '2026-04-28T00:00:00+00:00'::timestamptz,
      '2026-04-28T23:59:59+00:00'::timestamptz,
      jsonb_build_array(
        -- two shifts; Alice is not scheduled Apr 28 yet, Bob is not either
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000002',
          'start_time',  '2026-04-28T09:00:00+00:00',
          'end_time',    '2026-04-28T17:00:00+00:00',
          'break_duration', 30,
          'position', 'Server'
        ),
        jsonb_build_object(
          'employee_id', 'aaaaaaaa-0000-0000-0000-000000000003',
          'start_time',  '2026-04-28T10:00:00+00:00',
          'end_time',    '2026-04-28T18:00:00+00:00',
          'break_duration', 0,
          'position', 'Cook'
        )
      ),
      'merge'
    ))->>'skipped_count'
  ),
  '0',
  'apply merge mode skipped_count is 0 when no overlaps exist'
);

-- Test 15: merge mode does not delete existing shifts
SELECT is(
  (SELECT count(*)::integer FROM shifts
   WHERE id = 'cccccccc-0000-0000-0000-000000000001'),
  1,
  'apply merge mode leaves existing shifts intact'
);

-- Test 16: invalid merge_mode raises exception
SELECT throws_ok(
  $$SELECT apply_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '2026-05-01T00:00:00+00:00'::timestamptz,
      '2026-05-07T23:59:59+00:00'::timestamptz,
      '[]'::jsonb,
      'upsert'
    )$$,
  'P0001',
  NULL,
  'apply_schedule_plan_template rejects invalid merge_mode'
);

-- ============================================
-- delete_schedule_plan_template
-- ============================================

-- Capture a template id for delete tests
CREATE TEMP TABLE _tmpl_ids AS
  SELECT id FROM schedule_plan_templates
  WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
  ORDER BY created_at
  LIMIT 1;

-- Test 17: deleting an existing template via RPC succeeds
SELECT lives_ok(
  $$SELECT delete_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _tmpl_ids LIMIT 1)
    )$$,
  'delete_schedule_plan_template happy path succeeds'
);

-- Test 18: verify the row count decreased by 1 (from 5 to 4)
SELECT is(
  (SELECT count(*)::integer FROM schedule_plan_templates
   WHERE restaurant_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  4,
  'delete_schedule_plan_template removes the template from the table'
);

-- Test 19: deleting a non-existent template raises exception
SELECT throws_ok(
  $$SELECT delete_schedule_plan_template(
      'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
      '99999999-9999-9999-9999-999999999999'::uuid
    )$$,
  'P0001',
  'Template not found',
  'delete_schedule_plan_template raises exception when template not found'
);

SELECT * FROM finish();
ROLLBACK;
