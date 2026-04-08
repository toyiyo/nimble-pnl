BEGIN;
SELECT plan(3);

-- Test 1: area column exists on employees table
SELECT has_column('public', 'employees', 'area', 'employees table has area column');

-- Test 2: area column is nullable
SELECT col_is_null('public', 'employees', 'area', 'area column is nullable');

-- Test 3: index exists for area lookups
SELECT has_index('public', 'employees', 'idx_employees_area', 'index idx_employees_area exists');

SELECT * FROM finish();
ROLLBACK;
