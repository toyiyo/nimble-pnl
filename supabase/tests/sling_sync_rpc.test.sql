-- Tests for sync_sling_to_shifts_and_punches RPC function
BEGIN;
SELECT plan(4);

-- Test function exists
SELECT has_function(
  'sync_sling_to_shifts_and_punches',
  ARRAY['uuid', 'date', 'date'],
  'sync_sling_to_shifts_and_punches function should exist'
);

-- Test it runs without error on empty data
SELECT lives_ok(
  $$SELECT sync_sling_to_shifts_and_punches('00000000-0000-0000-0000-000000000000'::UUID, '2026-01-01'::DATE, '2026-01-31'::DATE)$$,
  'sync function runs on empty data without error'
);

-- Set up test fixtures
INSERT INTO restaurants (id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'Test Sling Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, restaurant_id, name, position, hourly_rate)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'John Doe', 'Server', 1500)
ON CONFLICT (id) DO NOTHING;

INSERT INTO employee_integration_mappings (restaurant_id, employee_id, integration_type, external_user_id, external_user_name)
VALUES ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'sling', '99001', 'John Doe')
ON CONFLICT (restaurant_id, integration_type, external_user_id) DO NOTHING;

INSERT INTO sling_shifts (restaurant_id, sling_shift_id, sling_user_id, shift_date, start_time, end_time, break_duration, position, status)
VALUES ('11111111-1111-1111-1111-111111111111', 50001, 99001, '2026-01-15', '2026-01-15 09:00:00+00', '2026-01-15 17:00:00+00', 30, 'Server', 'published');

INSERT INTO sling_timesheets (restaurant_id, sling_timesheet_id, sling_shift_id, sling_user_id, punch_type, punch_time)
VALUES ('11111111-1111-1111-1111-111111111111', 60001, 50001, 99001, 'clock_in', '2026-01-15 08:55:00+00');

-- Run sync
SELECT lives_ok(
  $$SELECT sync_sling_to_shifts_and_punches('11111111-1111-1111-1111-111111111111'::UUID, '2026-01-01'::DATE, '2026-01-31'::DATE)$$,
  'sync function processes test data without error'
);

-- Verify shift was synced
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM shifts WHERE restaurant_id = '11111111-1111-1111-1111-111111111111' AND source_type = 'sling'),
  1,
  'shift was synced from sling_shifts'
);

SELECT * FROM finish();
ROLLBACK;
