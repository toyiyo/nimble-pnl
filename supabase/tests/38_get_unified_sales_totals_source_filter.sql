-- Tests for get_unified_sales_totals: optional pos_system/source filter
BEGIN;
SELECT plan(4);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000003"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000003'::uuid, 'source-filter@example.com')
ON CONFLICT DO NOTHING;

INSERT INTO restaurants (id, name, address, phone) VALUES
  ('00000000-0000-0000-0000-000000000097'::uuid, 'Source Filter Test Restaurant', '100 Source St', '555-0097')
ON CONFLICT (id) DO UPDATE SET name = 'Source Filter Test Restaurant';

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000003'::uuid, '00000000-0000-0000-0000-000000000097'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO NOTHING;

INSERT INTO unified_sales (id, restaurant_id, pos_system, external_order_id, item_name, quantity, total_price, sale_date)
VALUES
  ('00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-000000000097'::uuid, 'toast', 'src-1', 'Toast Burger', 1, 20.00, '2024-08-01'),
  ('00000000-0000-0000-0000-0000000000b2'::uuid, '00000000-0000-0000-0000-000000000097'::uuid, 'manual', 'src-2', 'Manual Burger', 1, 30.00, '2024-08-01')
ON CONFLICT (id) DO UPDATE SET
  pos_system = EXCLUDED.pos_system,
  total_price = EXCLUDED.total_price,
  sale_date = EXCLUDED.sale_date,
  parent_sale_id = NULL;

SELECT is(
  (SELECT total_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000097'::uuid, '2024-08-01'::DATE, '2024-08-01'::DATE, NULL, 'toast'
  )),
  1::BIGINT,
  'toast source filter returns only toast sales'
);

SELECT is(
  (SELECT revenue FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000097'::uuid, '2024-08-01'::DATE, '2024-08-01'::DATE, NULL, 'manual'
  )),
  30.00::NUMERIC,
  'manual source filter returns only manual revenue'
);

SELECT is(
  (SELECT total_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000097'::uuid, '2024-08-01'::DATE, '2024-08-01'::DATE, NULL, NULL
  )),
  2::BIGINT,
  'null source filter includes all sources'
);

SELECT is(
  (SELECT total_count FROM get_unified_sales_totals(
    '00000000-0000-0000-0000-000000000097'::uuid, '2024-08-01'::DATE, '2024-08-01'::DATE, NULL, 'square'
  )),
  0::BIGINT,
  'non-matching source filter returns no rows'
);

SELECT * FROM finish();
ROLLBACK;
