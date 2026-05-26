BEGIN;
SELECT plan(7);

-- Column exists, correct type, nullable
SELECT has_column('public', 'receipt_imports', 'file_hash', 'file_hash column should exist');
SELECT col_type_is('public', 'receipt_imports', 'file_hash', 'text', 'file_hash should be text type');
SELECT col_is_null('public', 'receipt_imports', 'file_hash', 'file_hash should be nullable');

-- Hash-lookup index exists and is partial on file_hash IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_hash_idx'
      AND indexdef ILIKE '%(restaurant_id, file_hash)%'
      AND indexdef ILIKE '%WHERE (file_hash IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_hash_idx exists as partial composite (restaurant_id, file_hash)'
);

-- Semantic-lookup index exists and is partial on purchase_date IS NOT NULL
SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname = 'receipt_imports_restaurant_purchase_date_idx'
      AND indexdef ILIKE '%(restaurant_id, purchase_date)%'
      AND indexdef ILIKE '%WHERE (purchase_date IS NOT NULL)%'
  ),
  'receipt_imports_restaurant_purchase_date_idx exists as partial composite (restaurant_id, purchase_date)'
);

-- Neither index covers NULL rows (verify partial predicate exists by counting)
SELECT is(
  (SELECT count(*)::int FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'receipt_imports'
      AND indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND indexdef ILIKE '%WHERE%'),
  2,
  'Both new indexes use a WHERE predicate (partial indexes)'
);

-- Indexes use btree (default), not some unrelated AM
SELECT is(
  (SELECT count(*)::int FROM pg_indexes pi
     JOIN pg_class c ON c.relname = pi.indexname
     JOIN pg_am am ON am.oid = c.relam
    WHERE pi.schemaname = 'public'
      AND pi.tablename = 'receipt_imports'
      AND pi.indexname IN ('receipt_imports_restaurant_hash_idx', 'receipt_imports_restaurant_purchase_date_idx')
      AND am.amname = 'btree'),
  2,
  'Both indexes use btree access method'
);

SELECT * FROM finish();
ROLLBACK;
