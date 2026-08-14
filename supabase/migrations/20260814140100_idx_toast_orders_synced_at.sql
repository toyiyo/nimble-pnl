-- supabase: no-transaction
--
-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file: the CLI
-- pipelines a file's statements, and CONCURRENTLY cannot run inside a
-- transaction (prior art: 20260524120100_add_file_hash_indexes.sql).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_orders_restaurant_synced_at
  ON public.toast_orders (restaurant_id, synced_at DESC);
