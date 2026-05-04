-- Tests for get_revenue_by_account: verifies that only rows with item_type='sale'
-- are included in revenue totals, excluding mis-typed rows (e.g. item_type='discount')
-- that have adjustment_type=NULL and would otherwise slip into the revenue figure.
--
-- Uses restaurant UUID 33333333-... and COA UUID 44444444-... to avoid collision
-- with Task 1 (11111111-...) and other test namespaces.
BEGIN;
SELECT plan(5);

-- Seed test restaurant
INSERT INTO restaurants (id, name)
VALUES ('33333333-3333-3333-3333-333333333333', 'pgTAP revenue-by-account restaurant')
ON CONFLICT (id) DO NOTHING;

-- Seed chart_of_accounts row for alcohol_sales
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance)
VALUES ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', '4100', 'Alcohol Sales', 'revenue', 'alcohol_sales', 'credit')
ON CONFLICT (id) DO NOTHING;

-- Clean any pre-existing unified_sales rows for this restaurant
DELETE FROM unified_sales WHERE restaurant_id = '33333333-3333-3333-3333-333333333333';

-- Seed unified_sales rows:
--   Row 1: legitimate sale categorized to alcohol_sales → should be counted ($100)
--   Row 2: mis-typed discount with adjustment_type=NULL, categorized to alcohol_sales → must be excluded ($5)
--   Row 3: mis-typed discount with adjustment_type=NULL, uncategorized → must be excluded ($9.99)
INSERT INTO unified_sales (
  id, restaurant_id, pos_system, external_order_id, external_item_id, item_name,
  quantity, unit_price, total_price, sale_date, item_type,
  is_categorized, category_id, adjustment_type
) VALUES
  -- Row 1: valid sale
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'test', 'ord-rba-1', 'item-rba-1', 'House Wine',
    1, 100.00, 100.00, '2026-04-15', 'sale',
    TRUE, '44444444-4444-4444-4444-444444444444', NULL),
  -- Row 2: mis-typed discount, categorized (the Russo's Pizzeria production bug)
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'test', 'ord-rba-2', 'item-rba-2', 'Happy Hour Discount',
    1, 5.00, 5.00, '2026-04-15', 'discount',
    TRUE, '44444444-4444-4444-4444-444444444444', NULL),
  -- Row 3: mis-typed discount, uncategorized
  (gen_random_uuid(), '33333333-3333-3333-3333-333333333333', 'test', 'ord-rba-3', 'item-rba-3', 'Promo Discount',
    1, 9.99, 9.99, '2026-04-15', 'discount',
    FALSE, NULL, NULL);

-- 1. Categorized branch: alcohol_sales total must be 100.00, not 105.00
SELECT is(
  (SELECT total_amount::numeric(10,2)
   FROM get_revenue_by_account('33333333-3333-3333-3333-333333333333'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE account_code = '4100'),
  100.00::numeric(10,2),
  'categorized alcohol_sales total is 100.00 (discount row excluded)'
);

-- 2. Categorized branch: transaction_count must be 1, not 2
SELECT is(
  (SELECT transaction_count::bigint
   FROM get_revenue_by_account('33333333-3333-3333-3333-333333333333'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE account_code = '4100'),
  1::bigint,
  'categorized transaction_count is 1 (discount row excluded)'
);

-- 3. Uncategorized branch: discount row must not appear (total = 0 rows, or UNCATEGORIZED row omitted)
--    The HAVING COUNT(*) > 0 guard means the row won't appear at all when count = 0.
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_revenue_by_account('33333333-3333-3333-3333-333333333333'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE account_code = 'UNCATEGORIZED'),
  0::bigint,
  'uncategorized branch returns no rows when only discount item_type rows exist'
);

-- 4. Categorized branch: no other accounts appear (only one COA row seeded)
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_revenue_by_account('33333333-3333-3333-3333-333333333333'::uuid, '2026-04-01'::date, '2026-04-30'::date)
   WHERE is_categorized = TRUE),
  1::bigint,
  'exactly one categorized account row is returned'
);

-- 5. Total result rows = 1 (one categorized account; UNCATEGORIZED suppressed by HAVING)
SELECT is(
  (SELECT COUNT(*)::bigint
   FROM get_revenue_by_account('33333333-3333-3333-3333-333333333333'::uuid, '2026-04-01'::date, '2026-04-30'::date)),
  1::bigint,
  'function returns exactly 1 row total (UNCATEGORIZED suppressed because count = 0)'
);

SELECT * FROM finish();
ROLLBACK;
