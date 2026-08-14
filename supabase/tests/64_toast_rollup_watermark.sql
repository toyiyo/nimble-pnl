-- pgTAP tests for the Toast rollup source watermark.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
BEGIN;
SELECT plan(4);

SELECT has_column('public', 'toast_connections', 'rollup_source_watermark',
  'toast_connections has rollup_source_watermark');
SELECT has_index('public', 'toast_orders', 'idx_toast_orders_restaurant_synced_at',
  'toast_orders has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_order_items', 'idx_toast_order_items_restaurant_synced_at',
  'toast_order_items has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_payments', 'idx_toast_payments_restaurant_synced_at',
  'toast_payments has the (restaurant_id, synced_at) index');

SELECT * FROM finish();
ROLLBACK;
