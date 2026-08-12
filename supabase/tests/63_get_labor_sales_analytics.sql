BEGIN;
SELECT plan(15);

-- Fixed identities for this test.
-- member:     00000000-0000-0000-0000-000000000000
-- restaurant: 00000000-0000-0000-0000-000000000099
-- non-member: 99999999-9999-9999-9999-999999999999

-- Seed as postgres so the fixture INSERTs bypass RLS.
SET LOCAL role TO postgres;

-- The member must exist in auth.users: user_restaurants.user_id has an FK to
-- auth.users(id). Seed it first.
INSERT INTO auth.users (id, email)
VALUES ('00000000-0000-0000-0000-000000000000', 'labor-rpc-test@example.com')
ON CONFLICT (id) DO NOTHING;

-- Seed a restaurant and a member.
INSERT INTO restaurants (id, name)
VALUES ('00000000-0000-0000-0000-000000000099', 'Labor RPC Test Diner')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role)
VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000099', 'owner')
ON CONFLICT DO NOTHING;

-- unified_sales requires pos_system, external_order_id, item_name (all NOT NULL,
-- no default). A partial unique index (restaurant_id, pos_system,
-- external_order_id, external_item_id) WHERE parent_sale_id IS NULL forces a
-- distinct external_order_id per null-parent row.

-- Included revenue rows.
-- S1: 2024-06-15 (Saturday = dow 6), sold_at 14:00Z wins over sale_time 09:00 -> hour 14, $100.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-1', 'Test Item', '2024-06-15', '09:00:00', '2024-06-15T14:00:00Z', 100, 'sale', NULL, NULL);
-- S2: 2024-06-15, no sold_at, sale_time 11:00 -> hour 11, $50.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-2', 'Test Item', '2024-06-15', '11:00:00', NULL, 50, 'sale', NULL, NULL);
-- S3: 2024-06-16 (Sunday = dow 0), no hour at all, $30.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-3', 'Test Item', '2024-06-16', NULL, NULL, 30, 'sale', NULL, NULL);

-- Excluded rows (must never appear in totals).
-- X1: adjustment_type set (a tip/adjustment), $1000.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-x1', 'Test Item', '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 1000, 'sale', NULL, 'tip');
-- X2: child of S1 (parent_sale_id set), $2000.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-x2', 'Test Item', '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 2000, 'sale',
        'aaaaaaaa-0000-0000-0000-000000000001', NULL);
-- X3: item_type not 'sale', $4000.
INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, sale_date, sale_time, sold_at, total_price, item_type, parent_sale_id, adjustment_type)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000099',
        'manual', 'ls-x3', 'Test Item', '2024-06-15', '14:00:00', '2024-06-15T14:00:00Z', 4000, 'tip', NULL, NULL);

-- Act as the member.
SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
SET LOCAL role = authenticated;

-- Main call: UTC so sold_at hour buckets are stable.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2024-06-01'::date, '2024-06-30'::date, 'UTC'
) AS r \gset

-- daily: 15th = 150, 16th = 30.
SELECT is(
  (SELECT jsonb_agg(elem ORDER BY (elem->>'sale_date'))
   FROM jsonb_array_elements(:'r'::jsonb->'daily') elem),
  '[{"sale_date": "2024-06-15", "revenue": 150}, {"sale_date": "2024-06-16", "revenue": 30}]'::jsonb,
  'daily sums per date, excludes tip/child/non-sale rows'
);

-- grid length 2 (only hour-bearing rows: S1, S2).
SELECT is(
  jsonb_array_length(:'r'::jsonb->'grid'), 2,
  'grid has one cell per hour-bearing sale bucket'
);
-- grid cell (dow 6, hour 14) = 100.
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 6 AND (elem->>'hour')::int = 14),
  100::numeric, 'grid cell Saturday 14:00 = 100 (sold_at wins)'
);
-- grid cell (dow 6, hour 11) = 50.
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 6 AND (elem->>'hour')::int = 11),
  50::numeric, 'grid cell Saturday 11:00 = 50 (sale_time)'
);
-- No grid cell at hour 9 (sold_at overrode sale_time for S1).
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'hour')::int = 9),
  0, 'sold_at overrides sale_time: no cell at hour 9'
);
-- The hourless row S3 is not in the grid.
SELECT is(
  (SELECT COUNT(*)::int FROM jsonb_array_elements(:'r'::jsonb->'grid') elem
   WHERE (elem->>'dow')::int = 0),
  0, 'hourless sale is excluded from the grid'
);

-- by_weekday: dow 0 = 30, dow 6 = 150 (all revenue, incl. hourless).
SELECT is(
  (SELECT jsonb_agg(elem ORDER BY (elem->>'dow')::int)
   FROM jsonb_array_elements(:'r'::jsonb->'by_weekday') elem),
  '[{"dow": 0, "revenue": 30}, {"dow": 6, "revenue": 150}]'::jsonb,
  'by_weekday sums all revenue per weekday, including hourless'
);

-- has_hourly true (S1/S2 carry hours).
SELECT is(:'r'::jsonb->'has_hourly', 'true'::jsonb, 'has_hourly true when any row has an hour');

-- Single-day 2024-06-16: only the hourless S3 -> has_hourly false, grid empty.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2024-06-16'::date, '2024-06-16'::date, 'UTC'
) AS r2 \gset
SELECT is(:'r2'::jsonb->'has_hourly', 'false'::jsonb, 'has_hourly false for a day with no hour-bearing rows');
SELECT is(jsonb_array_length(:'r2'::jsonb->'grid'), 0, 'grid empty for a day with no hour-bearing rows');
SELECT is(
  (SELECT (elem->>'revenue')::numeric FROM jsonb_array_elements(:'r2'::jsonb->'daily') elem),
  30::numeric, 'single-day daily still totals the hourless revenue'
);

-- Empty range: daily empty array, has_hourly false.
SELECT get_labor_sales_analytics(
  '00000000-0000-0000-0000-000000000099',
  '2020-01-01'::date, '2020-01-31'::date, 'UTC'
) AS r3 \gset
SELECT is(:'r3'::jsonb->'daily', '[]'::jsonb, 'empty range returns an empty daily array');
SELECT is(:'r3'::jsonb->'has_hourly', 'false'::jsonb, 'empty range returns has_hourly false');

-- Access control: a non-member is denied.
SET LOCAL request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';
SELECT throws_ok(
  $$ SELECT get_labor_sales_analytics('00000000-0000-0000-0000-000000000099', '2024-06-01'::date, '2024-06-30'::date, 'UTC') $$,
  'Access denied to restaurant',
  'non-member is denied'
);

-- Signature exists.
SELECT has_function(
  'public', 'get_labor_sales_analytics',
  ARRAY['uuid', 'date', 'date', 'text'],
  'get_labor_sales_analytics(uuid, date, date, text) exists'
);

SELECT * FROM finish();
ROLLBACK;
