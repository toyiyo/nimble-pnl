BEGIN;
SELECT plan(4);

-- Test 1: area column exists on shift_templates
SELECT has_column('public', 'shift_templates', 'area',
  'shift_templates should have an area column');

-- Test 2: area column is nullable
SELECT col_is_null('public', 'shift_templates', 'area',
  'area column should be nullable');

-- Test 3: area column is TEXT type
SELECT col_type_is('public', 'shift_templates', 'area', 'text',
  'area column should be TEXT');

-- Test 4: index exists for area lookups
SELECT has_index('public', 'shift_templates', 'idx_shift_templates_area',
  'shift_templates should have an area index');

SELECT * FROM finish();
ROLLBACK;
