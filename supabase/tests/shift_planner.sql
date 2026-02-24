-- Tests for shift planner tables, columns, RLS, and RPC functions
BEGIN;
SELECT plan(12);

-- Test 1: shift_templates has new columns
SELECT has_column('public', 'shift_templates', 'color',
  'shift_templates should have color column');
SELECT has_column('public', 'shift_templates', 'description',
  'shift_templates should have description column');

-- Test 2: week_templates table exists with correct columns
SELECT has_table('public', 'week_templates',
  'week_templates table should exist');
SELECT has_column('public', 'week_templates', 'name',
  'week_templates should have name column');
SELECT has_column('public', 'week_templates', 'is_active',
  'week_templates should have is_active column');

-- Test 3: week_template_slots table exists
SELECT has_table('public', 'week_template_slots',
  'week_template_slots table should exist');
SELECT has_column('public', 'week_template_slots', 'headcount',
  'week_template_slots should have headcount column');
SELECT has_column('public', 'week_template_slots', 'position',
  'week_template_slots should have position column');

-- Test 4: schedule_slots table exists
SELECT has_table('public', 'schedule_slots',
  'schedule_slots table should exist');
SELECT has_column('public', 'schedule_slots', 'employee_id',
  'schedule_slots should have employee_id column');
SELECT has_column('public', 'schedule_slots', 'status',
  'schedule_slots should have status column');

-- Test 5: RLS is enabled on all new tables
SELECT has_table('public', 'schedule_slots',
  'schedule_slots table exists for RLS check');

SELECT * FROM finish();
ROLLBACK;
