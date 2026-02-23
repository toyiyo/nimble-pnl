-- Tests for Sling integration tables, indexes, RLS policies, and triggers
BEGIN;
SELECT plan(15);

-- Test tables exist
SELECT has_table('public', 'sling_connections', 'sling_connections table should exist');
SELECT has_table('public', 'sling_users', 'sling_users table should exist');
SELECT has_table('public', 'sling_shifts', 'sling_shifts table should exist');
SELECT has_table('public', 'sling_timesheets', 'sling_timesheets table should exist');
SELECT has_table('public', 'employee_integration_mappings', 'employee_integration_mappings table should exist');

-- Test unique constraints exist
SELECT has_index('public', 'sling_connections', 'sling_connections_restaurant_id_key', 'sling_connections should have restaurant_id unique constraint');
SELECT has_index('public', 'sling_users', 'sling_users_restaurant_id_sling_user_id_key', 'sling_users should have composite unique constraint');
SELECT has_index('public', 'sling_shifts', 'sling_shifts_restaurant_id_sling_shift_id_key', 'sling_shifts should have composite unique constraint');
SELECT has_index('public', 'sling_timesheets', 'sling_timesheets_restaurant_id_sling_timesheet_id_key', 'sling_timesheets should have composite unique constraint');
SELECT has_index('public', 'employee_integration_mappings', 'eim_restaurant_integration_external_key', 'employee_integration_mappings should have composite unique constraint');

-- Test RLS policies exist
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sling_connections'
      AND policyname = 'Users can view sling connections for their restaurants'
  ),
  'sling_connections SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sling_users'
      AND policyname = 'Users can view sling users for their restaurants'
  ),
  'sling_users SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sling_shifts'
      AND policyname = 'Users can view sling shifts for their restaurants'
  ),
  'sling_shifts SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sling_timesheets'
      AND policyname = 'Users can view sling timesheets for their restaurants'
  ),
  'sling_timesheets SELECT policy should exist'
);
SELECT ok(
  EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'employee_integration_mappings'
      AND policyname = 'Users can view integration mappings for their restaurants'
  ),
  'employee_integration_mappings SELECT policy should exist'
);

SELECT * FROM finish();
ROLLBACK;
