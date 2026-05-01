-- Tests for get_pass_through_totals: verifies that only known adjustment types
-- (tax, tip, service_charge, discount, fee) are returned, and that unknown
-- types like 'void' and 'refund' are excluded.
BEGIN;
SELECT plan(4);

-- Seed a restaurant (no owner_id needed; matches pattern from 11_revenue_breakdown.sql)
INSERT INTO restaurants (id, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'pgTAP pass-through restaurant')
ON CONFLICT (id) DO NOTHING;

-- Clean up any pre-existing rows for this restaurant
DELETE FROM unified_sales WHERE restaurant_id = '11111111-1111-1111-1111-111111111111';

-- Seed adjustment rows: 5 known types + 2 unknown types
-- item_type must be a value allowed by the unified_sales_item_type_check constraint
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type, adjustment_type
) VALUES
  -- known types (should appear in result)
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-tax',  'Tax',            1,  100.00,  100.00, '2026-04-15', 'tax',      'tax'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-tip',  'Tip',            1,   50.00,   50.00, '2026-04-15', 'tip',      'tip'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-svc',  'Service Charge', 1,   25.00,   25.00, '2026-04-15', 'other',    'service_charge'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-disc', 'Discount',       1,  -10.00,  -10.00, '2026-04-15', 'discount', 'discount'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-fee',  'Fee',            1,    5.00,    5.00, '2026-04-15', 'other',    'fee'),
  -- unknown types (must NOT appear in result after the fix)
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-void', 'Void',           1, -200.00, -200.00, '2026-04-15', 'other',    'void'),
  (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'test', 'o1', 'i-ref',  'Refund',         1,  -75.00,  -75.00, '2026-04-15', 'refund',   'refund');

-- 1. void must NOT appear in result
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE adjustment_type = 'void'),
  0::bigint,
  'void rows are excluded'
);

-- 2. refund must NOT appear in result
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE adjustment_type = 'refund'),
  0::bigint,
  'refund rows are excluded'
);

-- 3. tax sum is correct
SELECT is(
  (SELECT total_amount::numeric
   FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE adjustment_type = 'tax'),
  100.00::numeric,
  'tax total is 100.00'
);

-- 4. exactly 5 known types are returned
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_pass_through_totals('11111111-1111-1111-1111-111111111111'::uuid, '2026-04-01'::date, '2026-04-30'::date)),
  5::bigint,
  'returns exactly 5 known adjustment types'
);

SELECT * FROM finish();
ROLLBACK;
