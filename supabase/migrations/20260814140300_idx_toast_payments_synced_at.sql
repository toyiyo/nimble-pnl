-- Serves the per-restaurant max(synced_at) probe in
-- sync_all_toast_to_unified_sales(). One statement per file (see
-- 20260814140100).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_toast_payments_restaurant_synced_at
  ON public.toast_payments (restaurant_id, synced_at DESC);
