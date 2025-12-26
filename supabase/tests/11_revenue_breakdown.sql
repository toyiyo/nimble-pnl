-- Tests for revenue breakdown and pass-through aggregation functions
BEGIN;
SELECT plan(5);

-- Test data
SELECT
  '00000000-0000-0000-0000-000000000111'::uuid AS restaurant_id,
  '2024-01-01'::date AS date_from,
  '2024-01-31'::date AS date_to
\gset

-- Ensure clean slate for all data
DELETE FROM unified_sales;

-- Seed a restaurant
INSERT INTO restaurants (id, name) VALUES (:'restaurant_id', 'P&L Test Restaurant');
-- Seed a second restaurant to satisfy FK for out-of-scope data
INSERT INTO restaurants (id, name) VALUES ('99999999-9999-9999-9999-999999999999', 'Other Resto');

-- Cleanup prior data for deterministic results
DELETE FROM unified_sales WHERE restaurant_id IN (:'restaurant_id', '99999999-9999-9999-9999-999999999999');
DELETE FROM daily_sales WHERE restaurant_id IN (:'restaurant_id', '99999999-9999-9999-9999-999999999999');
DELETE FROM chart_of_accounts WHERE restaurant_id IN (:'restaurant_id', '99999999-9999-9999-9999-999999999999');

-- Seed chart of accounts
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-000000000401', :'restaurant_id', '4000', 'Food Sales', 'revenue', 'food_sales', 'credit'),
  ('00000000-0000-0000-0000-000000000402', :'restaurant_id', '4001', 'Beverage Sales', 'revenue', 'beverage_sales', 'credit')
ON CONFLICT DO NOTHING;

-- Seed revenue and pass-through items
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type, parent_sale_id
) VALUES
  -- Categorized revenue (2 lines) + one split child
  ('00000000-0000-0000-0000-000000000201', :'restaurant_id', 'test', 'ord-1', 'item-1', 'Food Sale 1',
    1, 100, 100, :'date_from', 'sale', true, '00000000-0000-0000-0000-000000000401', NULL, NULL),
  ('00000000-0000-0000-0000-000000000202', :'restaurant_id', 'test', 'ord-2', 'item-2', 'Food Sale 2',
    1, 50, 50, :'date_from', 'sale', true, '00000000-0000-0000-0000-000000000401', NULL, NULL),
  -- Parent + child split: parent excluded, child included
  ('00000000-0000-0000-0000-000000000203', :'restaurant_id', 'test', 'ord-3', 'item-3', 'Split Parent',
    1, 30, 30, :'date_from', 'sale', true, '00000000-0000-0000-0000-000000000401', NULL, NULL),
  ('00000000-0000-0000-0000-000000000204', :'restaurant_id', 'test', 'ord-3-child', 'item-3a', 'Split Child',
    1, 30, 30, :'date_from', 'sale', true, '00000000-0000-0000-0000-000000000401', NULL, '00000000-0000-0000-0000-000000000203'),
  -- Uncategorized sale (should be grouped separately)
  ('00000000-0000-0000-0000-000000000205', :'restaurant_id', 'test', 'ord-4', 'item-4', 'Uncategorized Sale',
    1, 40, 40, :'date_from', 'sale', false, NULL, NULL, NULL),
  -- Pass-through items
  ('00000000-0000-0000-0000-000000000206', :'restaurant_id', 'test', 'ord-5', 'item-5', 'Sales Tax',
    1, 20, 20, :'date_from', 'sale', true, NULL, 'tax', NULL),
  ('00000000-0000-0000-0000-000000000207', :'restaurant_id', 'test', 'ord-6', 'item-6', 'Tips',
    1, 10, 10, :'date_from', 'sale', true, NULL, 'tip', NULL),
  ('00000000-0000-0000-0000-000000000208', :'restaurant_id', 'test', 'ord-7', 'item-7', 'Discount',
    1, -5, -5, :'date_from', 'sale', true, NULL, 'discount', NULL),
  -- Out-of-range data that should be ignored
  ('00000000-0000-0000-0000-000000000209', :'restaurant_id', 'test', 'ord-8', 'item-8', 'Old Sale',
    1, 999, 999, (:'date_from'::date - INTERVAL '60 days'), 'sale', true, '00000000-0000-0000-0000-000000000401', NULL, NULL);

-- get_revenue_by_account should sum categorized (100 + 50 + 30) and uncategorized (40) separately
SELECT results_eq(
  format(
    $fmt$
      SELECT account_code, total_amount::numeric(10,2), transaction_count, is_categorized
      FROM get_revenue_by_account(%L::uuid, %L::date, %L::date)
      WHERE account_code <> 'UNCATEGORIZED'
      ORDER BY account_code
    $fmt$,
    :'restaurant_id', :'date_from', :'date_to'
  ),
  'VALUES (''4000'', 180.00::numeric, 3::bigint, true)',
  'Categorized revenue is aggregated correctly (parent split excluded)'
);

SELECT results_eq(
  format(
    $fmt$
      SELECT account_code, total_amount::numeric(10,2), transaction_count, is_categorized
      FROM get_revenue_by_account(%L::uuid, %L::date, %L::date)
      WHERE account_code = 'UNCATEGORIZED'
    $fmt$,
    :'restaurant_id', :'date_from', :'date_to'
  ),
  'VALUES (''UNCATEGORIZED'', 40.00::numeric, 1::bigint, false)',
  'Uncategorized revenue is grouped separately'
);

-- get_pass_through_totals should group adjustments by type
SELECT results_eq(
  format(
    $fmt$
      SELECT adjustment_type, total_amount::numeric(10,2), transaction_count
      FROM get_pass_through_totals(%L::uuid, %L::date, %L::date)
      ORDER BY adjustment_type
    $fmt$,
    :'restaurant_id', :'date_from', :'date_to'
  ),
  $$
    VALUES
      ('discount', -5.00::numeric, 1::bigint),
      ('tax', 20.00::numeric, 1::bigint),
      ('tip', 10.00::numeric, 1::bigint)
  $$,
  'Pass-through totals are grouped by adjustment_type'
);

-- Should ignore other restaurants
SELECT is_empty(
  format(
    $fmt$
      SELECT 1 FROM get_revenue_by_account('99999999-9999-9999-9999-999999999999', %L::date, %L::date)
    $fmt$,
    :'date_from', :'date_to'
  ),
  'Other restaurants data is excluded'
);

-- Cleanup any preexisting data for other restaurant to avoid interference
DELETE FROM unified_sales WHERE restaurant_id = '99999999-9999-9999-9999-999999999999';
DELETE FROM daily_sales WHERE restaurant_id = '99999999-9999-9999-9999-999999999999';
DELETE FROM chart_of_accounts WHERE restaurant_id = '99999999-9999-9999-9999-999999999999';

SELECT is_empty(
  format(
    $fmt$
      SELECT 1 FROM get_pass_through_totals('99999999-9999-9999-9999-999999999999', %L::date, %L::date)
    $fmt$,
    :'date_from', :'date_to'
  ),
  'Pass-through totals exclude other restaurants'
);

SELECT * FROM finish();
ROLLBACK;
