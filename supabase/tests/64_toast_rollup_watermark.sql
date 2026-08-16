-- pgTAP tests for the Toast rollup source watermark.
-- Design: docs/superpowers/specs/2026-08-14-toast-rollup-watermark-design.md
-- now() is frozen inside this transaction. Future source rows use explicit
-- offsets (now() + interval 'N minutes') so each step's marker strictly
-- exceeds the stored watermark.
BEGIN;
SELECT plan(20);

SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_connections DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- No request.jwt.claims: auth.uid() is NULL, so the inner function's
-- membership check does not apply (service-role path).

-- ── Schema (Task 1) ─────────────────────────────────────────────────────
SELECT has_column('public', 'toast_connections', 'rollup_source_watermark',
  'toast_connections has rollup_source_watermark');
SELECT has_index('public', 'toast_orders', 'idx_toast_orders_restaurant_synced_at',
  'toast_orders has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_order_items', 'idx_toast_order_items_restaurant_synced_at',
  'toast_order_items has the (restaurant_id, synced_at) index');
SELECT has_index('public', 'toast_payments', 'idx_toast_payments_restaurant_synced_at',
  'toast_payments has the (restaurant_id, synced_at) index');

-- ── Fixtures ────────────────────────────────────────────────────────────
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-640000000011', 'Watermark Test Restaurant', '64 Wm Ave', '555-6400')
ON CONFLICT (id) DO NOTHING;

INSERT INTO toast_connections (id, restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active, last_sync_time, connection_status, initial_sync_done)
VALUES (
  '00000000-0000-0000-0000-640000000099',
  '00000000-0000-0000-0000-640000000011',
  'wm-client-id', 'encrypted-secret', 'wm-rest-guid',
  true, NOW() - INTERVAL '1 hour', 'connected', true
)
ON CONFLICT (id) DO UPDATE SET last_sync_time = EXCLUDED.last_sync_time, is_active = EXCLUDED.is_active, rollup_source_watermark = NULL;

INSERT INTO toast_orders (id, toast_order_guid, restaurant_id, toast_restaurant_guid, order_date, order_time, total_amount, tax_amount, raw_json)
VALUES ('00000000-0000-0000-0000-640000000021', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'wm-rest-guid', CURRENT_DATE, '12:00:00', 20.00, 1.50, '{}')
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE SET total_amount = EXCLUDED.total_amount;

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json)
VALUES ('wm-item-1', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Burger', 1, 20.00, 20.00, false, 0, 'Entrees', '{}')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET unit_price = EXCLUDED.unit_price;

INSERT INTO toast_payments (toast_payment_guid, toast_order_guid, restaurant_id, payment_date, payment_type, amount, tip_amount, payment_status, raw_json)
VALUES ('wm-pay-1', 'wm-order-1', '00000000-0000-0000-0000-640000000011', CURRENT_DATE, 'CREDIT', 20.00, 2.50, 'PAID', '{"refundStatus": "NONE"}')
ON CONFLICT (restaurant_id, toast_payment_guid, toast_order_guid) DO UPDATE SET tip_amount = EXCLUDED.tip_amount;

-- ── TEST 5: first run rolls up (watermark NULL) ─────────────────────────
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'First run emits one result row for the restaurant');

-- ── TEST 6: watermark equals the captured GREATEST ──────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT GREATEST(
    (SELECT max(o.synced_at) FROM toast_orders o
      WHERE o.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT max(i.synced_at) FROM toast_order_items i
      WHERE i.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT max(p.synced_at) FROM toast_payments p
      WHERE p.restaurant_id = '00000000-0000-0000-0000-640000000011'),
    (SELECT last_sync_time FROM toast_connections
      WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'))),
  'Watermark equals GREATEST of the source markers');

-- Snapshot state for the skip assertions.
CREATE TEMP TABLE wm_snapshot AS
SELECT
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011') AS watermark,
  (SELECT COUNT(*) FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011') AS us_count,
  (SELECT max(synced_at) FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011') AS us_max_synced;

-- ── TEST 7: second run skips (no source change) ─────────────────────────
SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  0,
  'Second run emits no row: the source did not move');

-- ── TEST 8: watermark unchanged after the skip ──────────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT watermark FROM wm_snapshot),
  'Skip leaves the watermark unchanged');

-- ── TEST 9: unified_sales untouched by the skip ─────────────────────────
SELECT is(
  (SELECT ROW(COUNT(*), max(synced_at))::text FROM unified_sales
    WHERE unified_sales.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT ROW(us_count, us_max_synced)::text FROM wm_snapshot),
  'Skip leaves unified_sales untouched');

-- ── TEST 10: a new source row forces a run ──────────────────────────────
INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json, synced_at)
VALUES ('wm-item-2', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Fries', 1, 5.00, 5.00, false, 0, 'Sides', '{}', now() + INTERVAL '1 minute')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET synced_at = EXCLUDED.synced_at;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'A new source row forces the next run');

-- ── TEST 11: watermark advanced to the new marker ───────────────────────
SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  now() + INTERVAL '1 minute',
  'Watermark advanced to the new source marker');

-- ── TEST 12: a last_sync_time bump alone forces a run ───────────────────
UPDATE toast_connections SET last_sync_time = now() + INTERVAL '2 minutes'
 WHERE restaurant_id = '00000000-0000-0000-0000-640000000011';

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'A last_sync_time bump alone forces the next run');

-- ── TESTS 13-15: a failed sync does not advance the watermark ───────────
CREATE FUNCTION public.wm_test_fail_insert() RETURNS trigger
LANGUAGE plpgsql AS $f$
BEGIN
  IF NEW.restaurant_id = '00000000-0000-0000-0000-640000000011'::uuid THEN
    RAISE EXCEPTION 'wm_test: injected failure';
  END IF;
  RETURN NEW;
END $f$;

CREATE TRIGGER wm_test_fail_insert BEFORE INSERT ON public.unified_sales
  FOR EACH ROW EXECUTE FUNCTION public.wm_test_fail_insert();

INSERT INTO toast_order_items (toast_item_guid, toast_order_guid, restaurant_id, item_name, quantity, unit_price, total_price, is_voided, discount_amount, menu_category, raw_json, synced_at)
VALUES ('wm-item-3', 'wm-order-1', '00000000-0000-0000-0000-640000000011', 'Wm Shake', 1, 6.00, 6.00, false, 0, 'Drinks', '{}', now() + INTERVAL '3 minutes')
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE SET synced_at = EXCLUDED.synced_at;

UPDATE wm_snapshot SET watermark =
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011');

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  0,
  'A failed sync emits no result row');

SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  (SELECT watermark FROM wm_snapshot),
  'A failed sync does not advance the watermark');

SELECT is(
  (SELECT connection_status FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  'error',
  'A failed sync records connection_status = error');

-- ── TESTS 16-18: the retry succeeds and advances the watermark ──────────
DROP TRIGGER wm_test_fail_insert ON public.unified_sales;
DROP FUNCTION public.wm_test_fail_insert();

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000011'),
  1,
  'The retry after the failure runs');

SELECT is(
  (SELECT rollup_source_watermark FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  now() + INTERVAL '3 minutes',
  'The retry advances the watermark to the newest marker');

SELECT is(
  (SELECT connection_status FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000011'),
  'connected',
  'The retry clears connection_status back to connected');

-- ── TESTS 19-20: every source marker NULL — the tick skips ──────────────
-- Design §4.4 invariant 3: GREATEST over four NULL inputs is NULL, and
-- NULL IS NOT DISTINCT FROM NULL, so a connection with no source rows and
-- no last_sync_time skips without a write.
INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-640000000012', 'Watermark Empty Restaurant', '64 Wm Blvd', '555-6401')
ON CONFLICT (id) DO NOTHING;

INSERT INTO toast_connections (id, restaurant_id, client_id, client_secret_encrypted, toast_restaurant_guid, is_active, last_sync_time, connection_status, initial_sync_done)
VALUES (
  '00000000-0000-0000-0000-640000000098',
  '00000000-0000-0000-0000-640000000012',
  'wm-client-id-2', 'encrypted-secret', 'wm-rest-guid-2',
  true, NULL, 'connected', false
)
ON CONFLICT (id) DO UPDATE SET last_sync_time = EXCLUDED.last_sync_time, is_active = EXCLUDED.is_active, rollup_source_watermark = NULL;

SELECT is(
  (SELECT COUNT(*)::INTEGER FROM sync_all_toast_to_unified_sales() f
    WHERE f.restaurant_id = '00000000-0000-0000-0000-640000000012'),
  0,
  'A connection with no source rows and NULL last_sync_time skips');

SELECT ok(
  (SELECT rollup_source_watermark IS NULL FROM toast_connections
    WHERE restaurant_id = '00000000-0000-0000-0000-640000000012'),
  'The skip leaves the NULL watermark NULL');

SELECT * FROM finish();
ROLLBACK;
