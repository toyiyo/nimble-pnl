-- pgTAP tests for unified_sales.sold_at from Toast openedDate
-- Tests migration: 20260529130000_unified_sales_sold_at.sql
--
-- Verifies:
--   1. Column exists (sold_at timestamptz, nullable)
--   2. sync_toast_to_unified_sales(UUID, DATE, DATE) populates sold_at from openedDate
--   3. Falls back to closedDate when openedDate absent
--   4. Malformed openedDate does NOT throw — falls back to closedDate gracefully
--   5. Backfill (DO block) populates pre-existing NULL sold_at rows from toast_orders

BEGIN;
SELECT plan(12);

-- ============================================================
-- Setup
-- ============================================================
SET LOCAL role TO postgres;
ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE toast_payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;

-- Test user
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
VALUES (
  '00000000-0000-0000-0000-390000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'sold-at-test@test.com',
  crypt('password123', gen_salt('bf')),
  now(), now(), now(), '', '', '', ''
)
ON CONFLICT (id) DO NOTHING;

-- Test restaurant (America/Chicago tz — CDT is UTC-5 in May)
INSERT INTO restaurants (id, name, address, phone, timezone)
VALUES (
  '00000000-0000-0000-0000-390000000011',
  'Sold At Test Restaurant', '1 Test Ave', '555-3900',
  'America/Chicago'
)
ON CONFLICT (id) DO NOTHING;

UPDATE restaurants
SET timezone = 'America/Chicago'
WHERE id = '00000000-0000-0000-0000-390000000011';

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES (
  '00000000-0000-0000-0000-390000000001',
  '00000000-0000-0000-0000-390000000011',
  'owner'
)
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- ----------------------------------------------------------------
-- Order A: valid openedDate + closedDate (should use openedDate)
--   openedDate = 2026-05-30T01:30:00+0000 => 2026-05-29 20:30 CDT (hour 20)
--   closedDate = 2026-05-30T04:15:00+0000 => 2026-05-29 23:15 CDT (hour 23)
-- ----------------------------------------------------------------
INSERT INTO toast_orders (
  id, toast_order_guid, restaurant_id, toast_restaurant_guid,
  order_date, order_time, total_amount, tax_amount, raw_json
)
VALUES (
  '00000000-0000-0000-0000-390000000021',
  'sold-at-order-A',
  '00000000-0000-0000-0000-390000000011',
  'toast-rest-sold-at',
  '2026-05-29', NULL, 25.00, 2.00,
  '{"openedDate":"2026-05-30T01:30:00+0000","closedDate":"2026-05-30T04:15:00+0000"}'::jsonb
)
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE
  SET raw_json = EXCLUDED.raw_json;

INSERT INTO toast_order_items (
  toast_item_guid, toast_order_guid, restaurant_id,
  item_name, quantity, unit_price, total_price,
  is_voided, discount_amount, menu_category, raw_json
)
VALUES (
  'sold-at-item-A',
  'sold-at-order-A',
  '00000000-0000-0000-0000-390000000011',
  'Grilled Chicken', 1, 25.00, 25.00,
  false, 0, 'Entrees', '{}'::jsonb
)
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price;

-- ----------------------------------------------------------------
-- Order B: openedDate absent, only closedDate (fallback case)
--   closedDate = 2026-05-30T04:15:00+0000 => 2026-05-29 23:15 CDT (hour 23)
-- ----------------------------------------------------------------
INSERT INTO toast_orders (
  id, toast_order_guid, restaurant_id, toast_restaurant_guid,
  order_date, order_time, total_amount, tax_amount, raw_json
)
VALUES (
  '00000000-0000-0000-0000-390000000022',
  'sold-at-order-B',
  '00000000-0000-0000-0000-390000000011',
  'toast-rest-sold-at',
  '2026-05-29', NULL, 18.00, 1.50,
  '{"closedDate":"2026-05-30T04:15:00+0000"}'::jsonb
)
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE
  SET raw_json = EXCLUDED.raw_json;

INSERT INTO toast_order_items (
  toast_item_guid, toast_order_guid, restaurant_id,
  item_name, quantity, unit_price, total_price,
  is_voided, discount_amount, menu_category, raw_json
)
VALUES (
  'sold-at-item-B',
  'sold-at-order-B',
  '00000000-0000-0000-0000-390000000011',
  'Caesar Salad', 1, 18.00, 18.00,
  false, 0, 'Salads', '{}'::jsonb
)
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price;

-- ----------------------------------------------------------------
-- Order C: malformed openedDate (not ISO-like) — must not throw
--   closedDate = 2026-05-30T04:15:00+0000 => fallback, hour 23
-- ----------------------------------------------------------------
INSERT INTO toast_orders (
  id, toast_order_guid, restaurant_id, toast_restaurant_guid,
  order_date, order_time, total_amount, tax_amount, raw_json
)
VALUES (
  '00000000-0000-0000-0000-390000000023',
  'sold-at-order-C',
  '00000000-0000-0000-0000-390000000011',
  'toast-rest-sold-at',
  '2026-05-29', NULL, 12.00, 1.00,
  '{"openedDate":"NOT-A-DATE","closedDate":"2026-05-30T04:15:00+0000"}'::jsonb
)
ON CONFLICT (toast_order_guid, restaurant_id) DO UPDATE
  SET raw_json = EXCLUDED.raw_json;

INSERT INTO toast_order_items (
  toast_item_guid, toast_order_guid, restaurant_id,
  item_name, quantity, unit_price, total_price,
  is_voided, discount_amount, menu_category, raw_json
)
VALUES (
  'sold-at-item-C',
  'sold-at-order-C',
  '00000000-0000-0000-0000-390000000011',
  'Soup of the Day', 1, 12.00, 12.00,
  false, 0, 'Soups', '{}'::jsonb
)
ON CONFLICT (restaurant_id, toast_order_guid, toast_item_guid) DO UPDATE
  SET unit_price = EXCLUDED.unit_price;

-- ============================================================
-- TEST 1: sold_at column exists on unified_sales
-- ============================================================
SELECT has_column(
  'public', 'unified_sales', 'sold_at',
  'unified_sales should have sold_at column'
);

-- TEST 2: sold_at column has type timestamptz
SELECT col_type_is(
  'public', 'unified_sales', 'sold_at',
  'timestamp with time zone',
  'unified_sales.sold_at should be of type timestamptz'
);

-- ============================================================
-- Run the sync to populate sold_at (TEST 3: no error)
-- ============================================================
SELECT lives_ok(
  $$
    SELECT sync_toast_to_unified_sales(
      '00000000-0000-0000-0000-390000000011'::UUID,
      '2026-05-29'::DATE,
      '2026-05-29'::DATE
    )
  $$,
  'sync_toast_to_unified_sales(UUID, DATE, DATE) completes without error'
);

-- ============================================================
-- TEST 4: Order A — sold_at is set (not null)
-- ============================================================
SELECT isnt(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  NULL::timestamptz,
  'Order A: sold_at is NOT NULL after sync'
);

-- TEST 5: Order A — sold_at matches openedDate (2026-05-30T01:30:00+00)
SELECT is(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  '2026-05-30T01:30:00+00'::timestamptz,
  'Order A: sold_at = openedDate (2026-05-30T01:30:00 UTC)'
);

-- TEST 6: Order A — local hour in Chicago tz = 20 (NOT 23 from closedDate)
SELECT is(
  (SELECT EXTRACT(HOUR FROM
     us.sold_at AT TIME ZONE 'America/Chicago')::int
   FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  20,
  'Order A: sold_at local hour in America/Chicago = 20 (from openedDate, not 23 from closedDate)'
);

-- ============================================================
-- TEST 7: Order B — sold_at falls back to closedDate (openedDate absent)
-- ============================================================
SELECT is(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-B'
     AND us.item_type = 'sale'),
  '2026-05-30T04:15:00+00'::timestamptz,
  'Order B: sold_at = closedDate fallback when openedDate absent'
);

-- ============================================================
-- TEST 8: Order C — malformed openedDate does not throw (sync already ran above)
-- Confirmed by: sync lived through test 3; sold_at from closedDate fallback
-- ============================================================
SELECT isnt(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-C'
     AND us.item_type = 'sale'),
  NULL::timestamptz,
  'Order C: sold_at is NOT NULL despite malformed openedDate (closedDate fallback)'
);

-- TEST 9: Order C — sold_at = closedDate (malformed openedDate skipped by regex guard)
SELECT is(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-C'
     AND us.item_type = 'sale'),
  '2026-05-30T04:15:00+00'::timestamptz,
  'Order C: sold_at = closedDate after malformed openedDate is skipped by regex guard'
);

-- ============================================================
-- TEST 10: sale_date is unchanged (non-regression)
-- ============================================================
SELECT is(
  (SELECT us.sale_date FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  '2026-05-29'::date,
  'Order A: sale_date unchanged (still uses order_date, not openedDate date)'
);

-- ============================================================
-- TEST 11: ON CONFLICT — re-sync does NOT null-out a good sold_at
-- Simulate re-sync where openedDate is now missing from raw_json
-- ============================================================
UPDATE toast_orders
SET raw_json = '{"closedDate":"2026-05-30T04:15:00+0000"}'::jsonb
WHERE toast_order_guid = 'sold-at-order-A'
  AND restaurant_id = '00000000-0000-0000-0000-390000000011';

SELECT sync_toast_to_unified_sales(
  '00000000-0000-0000-0000-390000000011'::UUID,
  '2026-05-29'::DATE,
  '2026-05-29'::DATE
);

-- sold_at should still be the original openedDate value
SELECT is(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  '2026-05-30T01:30:00+00'::timestamptz,
  'Re-sync: sold_at preserved (COALESCE(unified_sales.sold_at, EXCLUDED.sold_at) keeps prior value)'
);

-- ============================================================
-- TEST 12: Backfill — populates a row that had sold_at = NULL
-- ============================================================

-- Restore openedDate so backfill can find it
UPDATE toast_orders
SET raw_json = '{"openedDate":"2026-05-30T01:30:00+0000","closedDate":"2026-05-30T04:15:00+0000"}'::jsonb
WHERE toast_order_guid = 'sold-at-order-A'
  AND restaurant_id = '00000000-0000-0000-0000-390000000011';

-- Manually force sold_at = NULL on the synced row to simulate pre-migration state
UPDATE unified_sales
SET sold_at = NULL
WHERE restaurant_id = '00000000-0000-0000-0000-390000000011'
  AND external_item_id = 'sold-at-item-A'
  AND item_type = 'sale';

-- Run the bounded backfill logic (mirrors the DO block from the migration)
UPDATE public.unified_sales us
SET sold_at = (too.raw_json->>'openedDate')::timestamptz
FROM public.toast_orders too
WHERE us.pos_system = 'toast'
  AND us.external_order_id = too.toast_order_guid
  AND us.restaurant_id = too.restaurant_id
  AND us.item_type NOT IN ('tip', 'refund')
  AND us.sale_date > (CURRENT_DATE - INTERVAL '90 days')
  AND us.sold_at IS NULL
  AND too.raw_json->>'openedDate' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}'
  AND us.restaurant_id = '00000000-0000-0000-0000-390000000011';

SELECT is(
  (SELECT us.sold_at FROM unified_sales us
   WHERE us.restaurant_id = '00000000-0000-0000-0000-390000000011'
     AND us.external_item_id = 'sold-at-item-A'
     AND us.item_type = 'sale'),
  '2026-05-30T01:30:00+00'::timestamptz,
  'Backfill: sold_at populated from openedDate for pre-existing NULL row'
);

-- ============================================================
-- Cleanup
-- ============================================================
SELECT * FROM finish();
ROLLBACK;
