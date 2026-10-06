-- pgTAP tests for editable week templates
-- Tests: update_schedule_plan_template, validate_schedule_plan_template_shifts,
-- capability gate on save/apply/delete, the 20-template limit, the apply
-- active-employee filter, and the deleted INSERT/DELETE RLS policies.

BEGIN;

SELECT plan(34);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

-- Users: manager (owner), staff member, member of another restaurant
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
VALUES
  ('dddddddd-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@wtedit.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('dddddddd-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@wtedit.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', ''),
  ('dddddddd-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other@wtedit.test', crypt('password123', gen_salt('bf')), now(), now(), now(), '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('dddddddd-0000-0000-0000-000000000001', 'WT Edit Restaurant'),
  ('dddddddd-0000-0000-0000-000000000002', 'WT Other Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('dddddddd-0000-0000-0000-000000000010', 'dddddddd-0000-0000-0000-000000000001', 'owner'),
  ('dddddddd-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000001', 'staff'),
  ('dddddddd-0000-0000-0000-000000000012', 'dddddddd-0000-0000-0000-000000000002', 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, email, position, status, is_active) VALUES
  ('dddddddd-0000-0000-0000-000000000020', 'dddddddd-0000-0000-0000-000000000001', 'Ana',   'ana@wtedit.test',   'Server', 'active',   true),
  ('dddddddd-0000-0000-0000-000000000021', 'dddddddd-0000-0000-0000-000000000001', 'Ivan',  'ivan@wtedit.test',  'Cook',   'inactive', false),
  ('dddddddd-0000-0000-0000-000000000022', 'dddddddd-0000-0000-0000-000000000002', 'Omar',  'omar@wtedit.test',  'Server', 'active',   true)
ON CONFLICT (id) DO NOTHING;

-- Snapshot element helper
CREATE FUNCTION pg_temp.snap(p_emp uuid, p_day int, p_start text DEFAULT '09:00:00', p_end text DEFAULT '17:00:00')
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'day_offset', p_day, 'start_time', p_start, 'end_time', p_end,
    'break_duration', 30, 'position', 'Server',
    'employee_id', p_emp, 'employee_name', 'X', 'notes', NULL)
$$;

SET LOCAL role TO authenticated;
SET LOCAL "request.jwt.claims" TO '{"sub": "dddddddd-0000-0000-0000-000000000010", "role": "authenticated"}';

-- ============================================
-- save: create a template to edit
-- ============================================

-- 1
SELECT lives_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Base',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)))$$,
  'owner can save a snapshot-shaped template'
);

-- 2
SELECT ok(
  (SELECT (save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, '  Trimmed  ',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 1))))->>'updated_at' IS NOT NULL),
  'save returns updated_at'
);

-- 3
SELECT is(
  (SELECT name FROM schedule_plan_templates WHERE restaurant_id = 'dddddddd-0000-0000-0000-000000000001' AND name LIKE '%Trimmed%'),
  'Trimmed',
  'save trims the name'
);

CREATE TEMP TABLE _t AS
  SELECT id, updated_at FROM schedule_plan_templates
  WHERE restaurant_id = 'dddddddd-0000-0000-0000-000000000001' AND name = 'Base';
GRANT SELECT ON _t TO authenticated;

-- ============================================
-- update: happy path
-- ============================================

-- 4
SELECT is(
  (SELECT (update_schedule_plan_template(
      'dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Base v2',
      jsonb_build_array(
        pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0),
        pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 6, '22:00', '02:00')),
      (SELECT updated_at FROM _t)))->>'shift_count'),
  '2',
  'update returns the new shift_count'
);

-- 5
SELECT is(
  (SELECT name FROM schedule_plan_templates WHERE id = (SELECT id FROM _t)),
  'Base v2',
  'update changes the name'
);

-- 6
SELECT is(
  (SELECT jsonb_array_length(shifts) FROM schedule_plan_templates WHERE id = (SELECT id FROM _t)),
  2,
  'update replaces the shifts'
);

-- 7: a stale updated_at does not match. now() is constant inside one
-- transaction, so the test sends an older value. In production each RPC call
-- is its own transaction, and the trigger gives each update a new value.
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Stale',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)),
      (SELECT updated_at - interval '1 second' FROM _t))$$,
  'P0001',
  'Template was changed by another user. Reload and try again.',
  'update refuses a stale updated_at'
);

-- 8
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      '99999999-9999-9999-9999-999999999999'::uuid, 'Nope',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)), now())$$,
  'P0001',
  'Template not found',
  'update raises when the template does not exist'
);

-- 9
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Null ts',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)), NULL)$$,
  'P0001',
  'Expected updated_at is required',
  'update requires p_expected_updated_at'
);

-- 10
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Empty', '[]'::jsonb, now())$$,
  'P0001',
  'Cannot save an empty schedule template',
  'update refuses an empty shift array'
);

-- 11
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), '   ',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)), now())$$,
  'P0001',
  'Template name is required',
  'update refuses a blank name'
);

-- ============================================
-- validator
-- ============================================

-- 12
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Bad day',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 7)))$$,
  'P0001', 'Invalid template shift: day_offset must be a whole number from 0 to 6',
  'validator rejects day_offset 7'
);

-- 13
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Fraction day',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0) || '{"day_offset": 1.5}'::jsonb))$$,
  'P0001', 'Invalid template shift: day_offset must be a whole number from 0 to 6',
  'validator rejects a fractional day_offset'
);

-- 14
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Bad time',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0, '99:99', '17:00')))$$,
  'P0001', 'Invalid template shift: start_time and end_time must be HH:MM or HH:MM:SS',
  'validator rejects 99:99'
);

-- 15
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'ISO time',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0, '2026-04-07T09:00:00+00:00', '17:00')))$$,
  'P0001', 'Invalid template shift: start_time and end_time must be HH:MM or HH:MM:SS',
  'validator rejects an ISO timestamp'
);

-- 16
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Same time',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0, '09:00', '09:00:00')))$$,
  'P0001', 'Invalid template shift: start_time and end_time must differ',
  'validator compares times as time values'
);

-- 17
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Long break',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0) || '{"break_duration": 600}'::jsonb))$$,
  'P0001', 'Invalid template shift: break_duration must be a whole number from 0 to 480',
  'validator rejects a break over 480 minutes'
);

-- 18
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'No position',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0) || '{"position": null}'::jsonb))$$,
  'P0001', 'Invalid template shift: position is required (max 100 characters)',
  'validator rejects a null position'
);

-- 19
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Foreign emp',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000022'::uuid, 0)))$$,
  'P0001', 'Invalid template shift: employee does not belong to this restaurant',
  'validator rejects an employee of another restaurant'
);

-- 20: inactive employees of the same restaurant are allowed in a template
SELECT lives_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Has inactive',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000021'::uuid, 2)))$$,
  'validator accepts an inactive employee of the same restaurant'
);

-- 21: the validator is not callable by clients
SELECT throws_ok(
  $$SELECT validate_schedule_plan_template_shifts('dddddddd-0000-0000-0000-000000000001'::uuid, '[]'::jsonb)$$,
  '42501', NULL,
  'authenticated cannot execute the validator directly'
);

-- ============================================
-- 20-template limit (4 exist now: Base v2, Trimmed, Has inactive ... count it)
-- ============================================

-- 22
SELECT lives_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Fill ' || g,
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)))
    FROM generate_series(1, 20 - (SELECT count(*) FROM schedule_plan_templates
                                  WHERE restaurant_id = 'dddddddd-0000-0000-0000-000000000001')::int) g$$,
  'saving up to 20 templates succeeds'
);

-- 23
SELECT throws_ok(
  $$SELECT save_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, 'Twenty-first',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)))$$,
  'P0001',
  'Maximum of 20 schedule templates allowed. Delete one to save a new one.',
  'save enforces the 20-template limit'
);

-- ============================================
-- apply: active-employee filter
-- ============================================

-- 24: one active, one inactive, one foreign employee -> 1 inserted, 2 skipped
SELECT is(
  (SELECT apply_schedule_plan_template(
      'dddddddd-0000-0000-0000-000000000001'::uuid,
      '2026-06-01T00:00:00+00:00'::timestamptz, '2026-06-07T23:59:59+00:00'::timestamptz,
      jsonb_build_array(
        jsonb_build_object('employee_id', 'dddddddd-0000-0000-0000-000000000020', 'start_time', '2026-06-02T09:00:00+00:00', 'end_time', '2026-06-02T17:00:00+00:00', 'break_duration', 30, 'position', 'Server', 'notes', null),
        jsonb_build_object('employee_id', 'dddddddd-0000-0000-0000-000000000021', 'start_time', '2026-06-02T09:00:00+00:00', 'end_time', '2026-06-02T17:00:00+00:00', 'break_duration', 30, 'position', 'Cook', 'notes', null),
        jsonb_build_object('employee_id', 'dddddddd-0000-0000-0000-000000000022', 'start_time', '2026-06-02T09:00:00+00:00', 'end_time', '2026-06-02T17:00:00+00:00', 'break_duration', 30, 'position', 'Server', 'notes', null)),
      'replace') - 'deleted_count'),
  '{"inserted_count": 1, "skipped_count": 2}'::jsonb,
  'apply (replace) skips inactive and foreign employees'
);

-- 25
SELECT is(
  (SELECT count(*)::int FROM shifts WHERE employee_id = 'dddddddd-0000-0000-0000-000000000022'),
  0,
  'apply never inserts a shift for another restaurant''s employee'
);

-- 26: merge mode applies the same filter
SELECT is(
  (SELECT (apply_schedule_plan_template(
      'dddddddd-0000-0000-0000-000000000001'::uuid,
      '2026-06-08T00:00:00+00:00'::timestamptz, '2026-06-14T23:59:59+00:00'::timestamptz,
      jsonb_build_array(
        jsonb_build_object('employee_id', 'dddddddd-0000-0000-0000-000000000022', 'start_time', '2026-06-09T09:00:00+00:00', 'end_time', '2026-06-09T17:00:00+00:00', 'break_duration', 0, 'position', 'Server', 'notes', null)),
      'merge'))->>'inserted_count'),
  '0',
  'apply (merge) skips foreign employees'
);

-- ============================================
-- capability gate: staff member of the same restaurant
-- ============================================

SET LOCAL "request.jwt.claims" TO '{"sub": "dddddddd-0000-0000-0000-000000000011", "role": "authenticated"}';

-- 27
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'By staff',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)), now())$$,
  'P0001', 'Not authorized',
  'staff cannot update a template'
);

-- 28
SELECT throws_ok(
  $$SELECT delete_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid, (SELECT id FROM _t))$$,
  'P0001', 'Not authorized',
  'staff cannot delete a template'
);

-- 29: a direct insert is blocked by RLS (no INSERT policy)
SELECT throws_ok(
  $$INSERT INTO schedule_plan_templates (restaurant_id, name, shifts, shift_count)
    VALUES ('dddddddd-0000-0000-0000-000000000001', 'Direct', '[]'::jsonb, 0)$$,
  '42501', NULL,
  'a direct insert into schedule_plan_templates fails'
);

-- 30: a direct delete removes nothing (no DELETE policy)
DELETE FROM schedule_plan_templates WHERE id = (SELECT id FROM _t);
SET LOCAL "request.jwt.claims" TO '{"sub": "dddddddd-0000-0000-0000-000000000010", "role": "authenticated"}';
SELECT is(
  (SELECT count(*)::int FROM schedule_plan_templates WHERE id = (SELECT id FROM _t)),
  1,
  'a direct delete from schedule_plan_templates removes nothing'
);

-- ============================================
-- review fixes
-- ============================================

SET LOCAL "request.jwt.claims" TO '{"sub": "dddddddd-0000-0000-0000-000000000010", "role": "authenticated"}';

-- 31
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Extra key',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0) || '{"payload": "x"}'::jsonb), now())$$,
  'P0001', 'Invalid template shift: unknown field',
  'validator rejects unknown fields'
);

-- 32
SELECT throws_ok(
  $$SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      (SELECT id FROM _t), 'Bad uuid',
      jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0) || '{"employee_id": "not-a-uuid"}'::jsonb), now())$$,
  'P0001', 'Invalid template shift: employee_id is required',
  'validator rejects a malformed employee_id'
);

-- 33: update returns the full row (same shape as a SELECT)
SELECT ok(
  (SELECT r ?& ARRAY['id', 'restaurant_id', 'name', 'shifts', 'shift_count', 'created_at', 'updated_at']
   FROM (SELECT update_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
           (SELECT id FROM _t), 'Full row',
           jsonb_build_array(pg_temp.snap('dddddddd-0000-0000-0000-000000000020'::uuid, 0)),
           (SELECT updated_at FROM schedule_plan_templates WHERE id = (SELECT id FROM _t))) AS r) q),
  'update returns the full template row'
);

-- 34
SELECT throws_ok(
  $$SELECT apply_schedule_plan_template('dddddddd-0000-0000-0000-000000000001'::uuid,
      '2026-06-15T00:00:00+00:00'::timestamptz, '2026-06-21T23:59:59+00:00'::timestamptz, NULL, 'merge')$$,
  'P0001', 'Invalid shifts: expected an array',
  'apply rejects a NULL shift array'
);

SELECT * FROM finish();
ROLLBACK;
