-- Tests the fix for the gross_revenue double-count bug in
-- get_monthly_sales_metrics. The buggy version summed liability-categorized
-- sales into gross_revenue AND into sales_tax / other_liabilities; the fix
-- restricts gross_revenue to revenue-categorized + uncategorized sales only.

BEGIN;
SELECT plan(5);

-- get_monthly_sales_metrics now runs as SECURITY INVOKER and checks
-- user_restaurants membership. The test caller must be an authenticated
-- member of the restaurant it queries, so simulate a signed-in member.
SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000220"}';

ALTER TABLE restaurants DISABLE ROW LEVEL SECURITY;
ALTER TABLE unified_sales DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_restaurants DISABLE ROW LEVEL SECURITY;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000220'::uuid, 'monthly-metrics-test@example.com')
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

SELECT
  '00000000-0000-0000-0000-000000000222'::uuid AS restaurant_id,
  '2026-04-01'::date AS date_from,
  '2026-04-30'::date AS date_to
\gset

-- Clean baseline
DELETE FROM unified_sales WHERE restaurant_id = :'restaurant_id';
DELETE FROM chart_of_accounts WHERE restaurant_id = :'restaurant_id';

INSERT INTO restaurants (id, name) VALUES (:'restaurant_id', 'Monthly Metrics Test')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- The caller belongs to this restaurant.
INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000220'::uuid, :'restaurant_id', 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- A revenue account and a liability (sales tax) account
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000601', :'restaurant_id', '4000', 'Food Sales', 'revenue', 'food_sales', 'credit'),
  ('00000000-0000-0000-0000-000000000602', :'restaurant_id', '2200', 'Sales Tax Payable', 'liability', 'other_current_liabilities', 'credit')
ON CONFLICT DO NOTHING;

-- One revenue-categorized sale ($100), one liability-categorized sale ($10),
-- and one uncategorized sale ($50) in the same month.
-- The buggy RPC reported gross_revenue=110 here.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000701', :'restaurant_id', 'test', 'ord-r-1', 'item-r-1',
    'Burger', 1, 100, 100, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000601', NULL, NULL),
  ('00000000-0000-0000-0000-000000000702', :'restaurant_id', 'test', 'ord-l-1', 'item-l-1',
    'POS Sales Tax', 1, 10, 10, '2026-04-15', 'sale', true,
    '00000000-0000-0000-0000-000000000602', NULL, NULL),
  ('00000000-0000-0000-0000-000000000703', :'restaurant_id', 'test', 'ord-u-1', 'item-u-1',
    'Uncategorized Item', 1, 50, 50, '2026-04-15', 'sale', false,
    NULL, NULL, NULL);

-- gross_revenue must be 150 (100 revenue-categorized + 50 uncategorized via
-- the IS NULL branch; NOT 160 — the liability-categorized $10 must stay out).
SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  150.00::numeric,
  'gross_revenue includes revenue-categorized AND uncategorized (NULL category_id) sales but excludes liability-categorized'
);

-- The same liability-categorized sale must show up in sales_tax (it has
-- "tax" in the account name).
SELECT is(
  (SELECT sales_tax::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  10.00::numeric,
  'sales_tax still picks up liability-categorized sales-tax items'
);

-- Sanity: gross + sales_tax = 160 (no double-count).
SELECT is(
  (SELECT (gross_revenue + sales_tax)::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  160.00::numeric,
  'gross_revenue + sales_tax equals the actual money collected (no double-count)'
);

-- Explicit coverage for the IS NULL branch of the account_type filter:
-- without it, uncategorized sales (NULL category_id → NULL coa.account_type
-- after LEFT JOIN) would silently drop out of gross_revenue.
SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', :'date_from', :'date_to')
   WHERE period = '2026-04'),
  150.00::numeric,
  'uncategorized sales still count toward gross_revenue (NULL category_id pass-through)'
);

-- Cross-restaurant child boundary (defense in depth for the BYPASSRLS path).
-- The parent-sale check excludes a parent that has a child sale. Without the
-- restaurant_id filter, a child in ANOTHER restaurant suppresses an in-tenant
-- parent. This test runs on the RLS-disabled path (RLS is off above), so RLS
-- cannot hide the cross-restaurant child. The restaurant_id filter must.
-- Restaurant ...223 owns the child; the caller queries restaurant ...222.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000223'::uuid, 'Cross-Restaurant Child Test')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

DELETE FROM unified_sales WHERE restaurant_id = '00000000-0000-0000-0000-000000000223';

-- Parent P ($70, uncategorized, in the caller's restaurant, May 2026).
-- Child C references P but belongs to restaurant ...223.
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  ('00000000-0000-0000-0000-000000000801', :'restaurant_id', 'test', 'ord-p-1', 'item-p-1',
    'Parent Sale', 1, 70, 70, '2026-05-15', 'sale', false,
    NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000802', '00000000-0000-0000-0000-000000000223'::uuid,
    'test', 'ord-c-1', 'item-c-1',
    'Cross-Restaurant Child', 1, 999, 999, '2026-05-15', 'sale', false,
    NULL, NULL, '00000000-0000-0000-0000-000000000801');

-- gross_revenue must be 70. A child in restaurant ...223 must not suppress the
-- parent in restaurant ...222. Without the restaurant_id filter, the RPC drops
-- the parent and returns no 2026-05 row (gross_revenue NULL, the test fails).
SELECT is(
  (SELECT gross_revenue::numeric(10,2)
   FROM get_monthly_sales_metrics(:'restaurant_id', '2026-05-01'::date, '2026-05-31'::date)
   WHERE period = '2026-05'),
  70.00::numeric,
  'a child sale in another restaurant does not suppress an in-tenant parent sale'
);

SELECT * FROM finish();
ROLLBACK;
