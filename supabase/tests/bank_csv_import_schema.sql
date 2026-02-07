-- File: supabase/tests/bank_csv_import_schema.sql
-- Description: Tests for CSV import and duplicate detection schema changes

BEGIN;
SELECT plan(8);

-- Setup
SET LOCAL role TO postgres;

-- ============================================================
-- TEST: bank_statement_uploads new columns
-- ============================================================

-- Test 1: source_type column exists
SELECT has_column(
  'public',
  'bank_statement_uploads',
  'source_type',
  'bank_statement_uploads should have source_type column'
);

-- Test 2: source_type defaults to pdf
SELECT col_default_is(
  'public',
  'bank_statement_uploads',
  'source_type',
  '''pdf''::text',
  'source_type should default to pdf'
);

-- Test 3: connected_bank_id column exists
SELECT has_column(
  'public',
  'bank_statement_uploads',
  'connected_bank_id',
  'bank_statement_uploads should have connected_bank_id column'
);

-- ============================================================
-- TEST: bank_statement_lines duplicate detection columns
-- ============================================================

-- Test 4: is_potential_duplicate column exists
SELECT has_column(
  'public',
  'bank_statement_lines',
  'is_potential_duplicate',
  'bank_statement_lines should have is_potential_duplicate column'
);

-- Test 5: is_potential_duplicate defaults to false
SELECT col_default_is(
  'public',
  'bank_statement_lines',
  'is_potential_duplicate',
  'false',
  'is_potential_duplicate should default to false'
);

-- Test 6: duplicate_transaction_id column exists
SELECT has_column(
  'public',
  'bank_statement_lines',
  'duplicate_transaction_id',
  'bank_statement_lines should have duplicate_transaction_id column'
);

-- Test 7: duplicate_confidence column exists
SELECT has_column(
  'public',
  'bank_statement_lines',
  'duplicate_confidence',
  'bank_statement_lines should have duplicate_confidence column'
);

-- ============================================================
-- TEST: bank_transactions date+amount index
-- ============================================================

-- Test 8: Index for duplicate detection exists
SELECT ok(
  (SELECT COUNT(*) > 0 FROM pg_indexes
   WHERE tablename = 'bank_transactions'
   AND indexname = 'idx_bank_transactions_date_amount'),
  'Should have idx_bank_transactions_date_amount index for duplicate detection'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
