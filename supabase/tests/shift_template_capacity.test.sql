-- pgTAP tests for shift_templates.capacity column
-- Tests: column exists, default is 1, capacity >= 1 CHECK constraint

BEGIN;

SELECT plan(6);

-- ============================================
-- Setup: disable RLS for test data creation
-- ============================================

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE shift_templates DISABLE ROW LEVEL SECURITY;

INSERT INTO restaurants (id, name)
VALUES ('cccccccc-1111-0000-0000-000000000001', 'Capacity Test Restaurant')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Test 1: capacity column exists on shift_templates
-- ============================================

SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_templates'
      AND column_name = 'capacity'
  ),
  'shift_templates has a capacity column'
);

-- ============================================
-- Test 2: capacity column is NOT NULL
-- ============================================

SELECT is(
  (
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shift_templates'
      AND column_name = 'capacity'
  ),
  'NO',
  'capacity column is NOT NULL'
);

-- ============================================
-- Test 3: capacity defaults to 1
-- ============================================

INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, break_duration, position, days)
VALUES (
  'cccccccc-1111-0000-0000-000000000010',
  'cccccccc-1111-0000-0000-000000000001',
  'Morning Shift',
  '09:00:00',
  '17:00:00',
  0,
  'Server',
  '{1,2,3,4,5}'
);

SELECT is(
  (SELECT capacity FROM shift_templates WHERE id = 'cccccccc-1111-0000-0000-000000000010'),
  1,
  'capacity defaults to 1 when not specified'
);

-- ============================================
-- Test 4: capacity = 3 is valid (happy path)
-- ============================================

SELECT lives_ok(
  $$
    INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, break_duration, position, days, capacity)
    VALUES (
      'cccccccc-1111-0000-0000-000000000011',
      'cccccccc-1111-0000-0000-000000000001',
      'Evening Shift',
      '17:00:00',
      '23:00:00',
      0,
      'Cook',
      '{1,2,3,4,5}',
      3
    )
  $$,
  'capacity = 3 inserts successfully'
);

-- ============================================
-- Test 5: capacity = 0 violates CHECK constraint
-- ============================================

SELECT throws_ok(
  $$
    INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, break_duration, position, days, capacity)
    VALUES (
      'cccccccc-1111-0000-0000-000000000012',
      'cccccccc-1111-0000-0000-000000000001',
      'Bad Shift Zero',
      '08:00:00',
      '16:00:00',
      0,
      'Host',
      '{1}',
      0
    )
  $$,
  '23514',
  NULL,
  'capacity = 0 violates check constraint'
);

-- ============================================
-- Test 6: capacity = -1 violates CHECK constraint
-- ============================================

SELECT throws_ok(
  $$
    INSERT INTO shift_templates (id, restaurant_id, name, start_time, end_time, break_duration, position, days, capacity)
    VALUES (
      'cccccccc-1111-0000-0000-000000000013',
      'cccccccc-1111-0000-0000-000000000001',
      'Bad Shift Negative',
      '08:00:00',
      '16:00:00',
      0,
      'Host',
      '{1}',
      -1
    )
  $$,
  '23514',
  NULL,
  'capacity = -1 violates check constraint'
);

SELECT * FROM finish();
ROLLBACK;
