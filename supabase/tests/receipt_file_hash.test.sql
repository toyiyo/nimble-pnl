BEGIN;
SELECT plan(3);

-- Column exists, correct type, nullable
SELECT has_column('public', 'receipt_imports', 'file_hash', 'file_hash column should exist');
SELECT col_type_is('public', 'receipt_imports', 'file_hash', 'text', 'file_hash should be text type');
SELECT col_is_null('public', 'receipt_imports', 'file_hash', 'file_hash should be nullable');

SELECT * FROM finish();
ROLLBACK;
