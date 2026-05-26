-- supabase: no-transaction
--
-- Split from 20260524120000_add_file_hash_to_receipt_imports.sql because
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- Precedent: supabase/migrations/20260521133931_bulk_set_employee_availability_index.sql
--
-- NOTE: Supabase CLI v2.101.0 runs migration statements in a pipeline, so
-- only ONE CREATE INDEX CONCURRENTLY is allowed per migration file.
-- The second index is in 20260524120200_add_purchase_date_index.sql.
--
-- This index is partial: legacy NULL-hash rows can never match the
-- duplicate-detection queries, so excluding them keeps the index narrow.

-- Hash lookup: WHERE restaurant_id = ? AND file_hash = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_hash_idx
  ON public.receipt_imports (restaurant_id, file_hash)
  WHERE file_hash IS NOT NULL;
