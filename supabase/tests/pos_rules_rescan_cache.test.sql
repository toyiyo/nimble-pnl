BEGIN;
SELECT plan(7);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------- fixtures
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009a1', 'Rescan Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-0000000009c1', '00000000-0000-0000-0000-0000000009a1',
   'Food Sales', '4000', 'revenue', 'sales', 'credit'),
  ('00000000-0000-0000-0000-0000000009c2', '00000000-0000-0000-0000-0000000009a1',
   'Cash', '1000', 'asset', 'cash', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name)
VALUES
  ('00000000-0000-0000-0000-0000000009b1', '00000000-0000-0000-0000-0000000009a1',
   'fa_rescan_test', 'Rescan Test Bank')
ON CONFLICT (id) DO NOTHING;

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009d1', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-rescan-1', 'Widget Burger', 1, CURRENT_DATE, 10.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount)
VALUES
  ('00000000-0000-0000-0000-0000000009e1', '00000000-0000-0000-0000-0000000009a1',
   '00000000-0000-0000-0000-0000000009b1', 'txn-rescan-1', now(),
   'SYSCO FOOD SERVICE', -250.00)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- TEST 1-2
-- New columns exist and default to '-infinity' for freshly inserted rows.
SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'unified_sales.rules_evaluated_at defaults to -infinity'
);

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'bank_transactions.rules_evaluated_at defaults to -infinity'
);

-- ---------------------------------------------------------------- TEST 3
-- Changing a match input resets the stamp; changing an unrelated column does not.
UPDATE unified_sales SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET quantity = 2
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET item_name = 'Widget Burger Deluxe'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'changing item_name resets rules_evaluated_at (and changing quantity did not)'
);

-- ---------------------------------------------------------------- TEST 4
UPDATE bank_transactions SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET is_reconciled = true
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET amount = -300.00
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'changing amount resets rules_evaluated_at (and changing is_reconciled did not)'
);

-- ---------------------------------------------------------------- TEST 5-6
-- Selectivity: an update touching no match input must leave the stamp alone.
UPDATE unified_sales SET rules_evaluated_at = '2026-01-01T00:00:00Z'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE unified_sales SET external_order_id = 'ord-rescan-1-renamed'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'updating a non-match-input column leaves unified_sales.rules_evaluated_at intact'
);

UPDATE bank_transactions SET rules_evaluated_at = '2026-01-01T00:00:00Z'
 WHERE id = '00000000-0000-0000-0000-0000000009e1';
UPDATE bank_transactions SET is_transfer = true
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'updating a non-match-input column leaves bank_transactions.rules_evaluated_at intact'
);

-- ---------------------------------------------------------------- TEST 7
SELECT has_index(
  'public', 'unified_sales', 'idx_unified_sales_rule_candidates_v2',
  'partial candidate index on unified_sales exists'
);

SELECT * FROM finish();
ROLLBACK;
