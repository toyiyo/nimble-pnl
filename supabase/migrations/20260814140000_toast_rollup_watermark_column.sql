-- Watermark for the 5-minute Toast rollup skip.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md §4.1
ALTER TABLE public.toast_connections
  ADD COLUMN IF NOT EXISTS rollup_source_watermark timestamptz;

COMMENT ON COLUMN public.toast_connections.rollup_source_watermark IS
  'Newest Toast source marker at the last successful rollup: GREATEST of '
  'max(synced_at) over toast_orders, toast_order_items, toast_payments, and '
  'last_sync_time. NULL = never rolled up under this scheme. '
  'sync_all_toast_to_unified_sales() skips the restaurant when this value '
  'did not move.';
