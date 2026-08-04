BEGIN;
SELECT plan(22);

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

-- ---------------------------------------------------------------- TEST 8
SELECT has_index(
  'public', 'bank_transactions', 'idx_bank_transactions_rule_candidates_v2',
  'partial candidate index on bank_transactions exists'
);

-- ================================================================ SWEEP
-- Rule that matches nothing in the fixture set.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009f1', '00000000-0000-0000-0000-0000000009a1',
   'Never matches', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'zzz-no-such-item', 'exact', true, true, 10)
ON CONFLICT (id) DO NOTHING;

-- Reset the fixture row to a clean uncategorized state.
UPDATE unified_sales
   SET item_name = 'Widget Burger', category_id = NULL, is_categorized = false,
       is_split = false
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

-- ---------------------------------------------------------------- TEST 9
SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', 100)$$,
  'sweep runs against a restaurant with one non-matching rule'
);

-- ---------------------------------------------------------------- TEST 10
SELECT isnt(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'a row that matched no rule is stamped as evaluated'
);

-- ---------------------------------------------------------------- TEST 11
-- Core assertion: the second sweep sees no candidates at all.
SELECT is(
  (SELECT total_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'second sweep re-evaluates nothing'
);

-- ---------------------------------------------------------------- TEST 12
-- Editing a rule moves the watermark and re-opens the row. The
-- update_categorization_rules_updated_at trigger stamps updated_at = NOW(),
-- which is transaction-frozen for the life of this pgTAP script (one
-- BEGIN..ROLLBACK), so a plain UPDATE never actually advances it here.
-- Bypass the trigger for this one statement and use clock_timestamp()
-- (which does advance) to simulate a real subsequent edit.
ALTER TABLE categorization_rules DISABLE TRIGGER update_categorization_rules_updated_at;
UPDATE categorization_rules SET priority = 20, updated_at = clock_timestamp()
 WHERE id = '00000000-0000-0000-0000-0000000009f1';
ALTER TABLE categorization_rules ENABLE TRIGGER update_categorization_rules_updated_at;

SELECT is(
  (SELECT count(*)::int FROM unified_sales s
    WHERE s.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
      AND s.rules_evaluated_at < (
        SELECT max(GREATEST(cr.created_at, COALESCE(cr.updated_at, cr.created_at)))
        FROM categorization_rules cr
        WHERE cr.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
          AND cr.is_active = true
          AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both'))),
  1,
  'editing a rule re-opens previously stamped rows'
);

-- ---------------------------------------------------------------- TEST 13
-- Inserting a new rule also re-opens them, and the sweep applies it.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009f2', '00000000-0000-0000-0000-0000000009a1',
   'Burgers to food sales', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'Widget Burger', 'exact', true, true, 30)
ON CONFLICT (id) DO NOTHING;

SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'a newly inserted rule re-opens stamped rows and gets applied'
);

-- ---------------------------------------------------------------- TEST 14
SELECT is(
  (SELECT category_id FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '00000000-0000-0000-0000-0000000009c1'::uuid,
  'the matched row carries the rule category'
);

-- ---------------------------------------------------------------- TEST 15
-- Deactivating a rule lowers the watermark; the negative cache stays valid.
-- (rules_evaluated_at is left as test 13's sweep call set it -- the current
-- watermark including f1 and f2 both active -- so it is already >= whatever
-- the watermark becomes once f2 is deactivated below.)
UPDATE unified_sales
   SET category_id = NULL, is_categorized = false
 WHERE id = '00000000-0000-0000-0000-0000000009d1';
UPDATE categorization_rules SET is_active = false
 WHERE id = '00000000-0000-0000-0000-0000000009f2';

SELECT is(
  (SELECT total_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'deactivating a rule does not re-open stamped rows'
);

-- ---------------------------------------------------------------- TEST 16-17
-- Restaurant with no applicable rule at all: return (0,0), write nothing.
UPDATE categorization_rules SET is_active = false
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';
UPDATE unified_sales SET rules_evaluated_at = '-infinity'
 WHERE id = '00000000-0000-0000-0000-0000000009d1';

SELECT is(
  (SELECT applied_count::text || '/' || total_count::text
     FROM apply_rules_to_pos_sales_internal(
       '00000000-0000-0000-0000-0000000009a1', 100)),
  '0/0',
  'restaurant with zero active rules returns (0,0)'
);

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d1'),
  '-infinity'::timestamptz,
  'restaurant with zero active rules writes nothing'
);

-- ---------------------------------------------------------------- TEST 18
-- Watermark must not be narrower than the matcher's own rule predicate:
-- the matcher ignores auto_apply, so the watermark must too.
UPDATE categorization_rules SET is_active = true, auto_apply = false
 WHERE id = '00000000-0000-0000-0000-0000000009f2';

SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'an active auto_apply=false rule still moves the watermark and gets applied'
);

-- ---------------------------------------------------------------- TEST 19
-- Boundedness: with p_batch_limit = 1, exactly one row leaves '-infinity'.
UPDATE unified_sales
   SET category_id = NULL, is_categorized = false, rules_evaluated_at = '-infinity'
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';

INSERT INTO unified_sales
  (restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
SELECT '00000000-0000-0000-0000-0000000009a1', 'toast',
       'ord-bulk-' || g, 'Bulk Item ' || g, 1, CURRENT_DATE, 5.00, 'Entrees'
FROM generate_series(1, 25) g;

-- Run the sweep as a plain statement (this file is a SQL script, not a plpgsql
-- body, so the result is simply discarded), then assert on the side effect.
SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a1', 1);

SELECT is(
  (SELECT count(*)::int FROM unified_sales u
    WHERE u.restaurant_id = '00000000-0000-0000-0000-0000000009a1'
      AND u.rules_evaluated_at > '-infinity'),
  1,
  'p_batch_limit = 1 stamps exactly one of 26 candidates'
);

-- ---------------------------------------------------------------- TEST 20-21
SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', 0)$$,
  'p_batch_limit must be a positive integer, got 0',
  'p_batch_limit = 0 still raises'
);

SELECT throws_ok(
  $$SELECT * FROM apply_rules_to_pos_sales_internal(
      '00000000-0000-0000-0000-0000000009a1', NULL)$$,
  'p_batch_limit must be a positive integer, got <NULL>',
  'p_batch_limit = NULL still raises'
);

-- ---------------------------------------------------------------- TEST 22
-- Split-rule branch: the parent becomes is_split = true with two children.
UPDATE categorization_rules SET is_active = false
 WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a1';

-- Insert the sale BEFORE the split rule exists: unified_sales has its own
-- BEFORE INSERT trigger (auto_categorize_pos_sale) that eagerly matches
-- against currently-active rules and would otherwise mark this row
-- is_categorized = true on arrival -- with a single category_id, not the
-- split semantics -- taking it out of the sweep's candidate set before the
-- sweep (the thing under test) ever runs. With no active rule yet, the
-- trigger is a no-op and the row lands uncategorized as intended.
INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009d9', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-split-1', 'Split Me', 1, CURRENT_DATE, 100.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, is_split_rule,
   split_categories)
VALUES
  ('00000000-0000-0000-0000-0000000009f3', '00000000-0000-0000-0000-0000000009a1',
   'Split burgers', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'Split Me', 'exact', true, true, 40, true,
   jsonb_build_array(
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c1',
                        'percentage', 60, 'description', 'food'),
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c2',
                        'percentage', 40, 'description', 'other')))
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a1', 100);

-- Asserting on the parent's is_split flag rather than on a child-row foreign
-- key: is_split is the column the sweep's own candidate predicate reads, so it
-- is the one whose behaviour this change could plausibly break.
SELECT is(
  (SELECT is_split FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009d9'),
  true,
  'split-rule branch still routes through split_pos_sale'
);

SELECT * FROM finish();
ROLLBACK;
