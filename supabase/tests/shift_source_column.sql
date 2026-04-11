BEGIN;
SELECT plan(4);

-- Test 1: Column exists
SELECT has_column('public', 'shifts', 'source',
  'shifts table should have a source column');

-- Test 2: Default value is 'manual'
SELECT col_default_is('public', 'shifts', 'source', 'manual'::text,
  'source column should default to manual');

-- Test 3: Column is NOT NULL
SELECT col_not_null('public', 'shifts', 'source',
  'source column should be NOT NULL');

-- Test 4: Existing shifts have source = 'manual'
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM shifts WHERE source != 'manual'
  ),
  'All existing shifts should have source = manual'
);

SELECT * FROM finish();
ROLLBACK;
