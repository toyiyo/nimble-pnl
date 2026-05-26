-- supabase: no-transaction
--
-- Continuation of 20260524120100_add_file_hash_indexes.sql.
-- Supabase CLI v2.101.0 runs migration statements in a pipeline, so
-- only ONE CREATE INDEX CONCURRENTLY is allowed per migration file.
--
-- This index is partial: legacy NULL-purchase_date rows can never match
-- the semantic duplicate-detection queries, so excluding them keeps the
-- index narrow.

-- Semantic lookup: WHERE restaurant_id = ? AND purchase_date = ?
-- vendor_name (ILIKE) and total_amount (BETWEEN) are residual filters on
-- the small per-restaurant/per-date subset and don't belong in the index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  receipt_imports_restaurant_purchase_date_idx
  ON public.receipt_imports (restaurant_id, purchase_date)
  WHERE purchase_date IS NOT NULL;
