BEGIN;
SELECT plan(44);

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

-- ================================================================ BANK SWEEP
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, description_pattern,
   description_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009fb', '00000000-0000-0000-0000-0000000009a1',
   'Never matches bank', 'bank_transactions', '00000000-0000-0000-0000-0000000009c1',
   'zzz-no-such-description', 'exact', true, true, 10)
ON CONFLICT (id) DO NOTHING;

UPDATE bank_transactions
   SET description = 'SYSCO FOOD SERVICE', amount = -250.00,
       category_id = NULL, is_categorized = false, is_split = false,
       excluded_reason = NULL
 WHERE id = '00000000-0000-0000-0000-0000000009e1';

-- ---------------------------------------------------------------- TEST 23
SELECT lives_ok(
  $$SELECT * FROM apply_rules_to_bank_transactions_internal(
      '00000000-0000-0000-0000-0000000009a1', 100)$$,
  'bank sweep runs against a restaurant with one non-matching rule'
);

-- ---------------------------------------------------------------- TEST 24
SELECT isnt(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e1'),
  '-infinity'::timestamptz,
  'a bank row that matched no rule is stamped as evaluated'
);

-- ---------------------------------------------------------------- TEST 25
SELECT is(
  (SELECT total_count FROM apply_rules_to_bank_transactions_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  0,
  'second bank sweep re-evaluates nothing'
);

-- ---------------------------------------------------------------- TEST 26-27
-- The v1 indexes are strict prefixes of the v2 ones with identical partial
-- predicates, so keeping both costs write amplification for nothing.
SELECT hasnt_index(
  'public', 'unified_sales', 'idx_unified_sales_rule_candidates',
  'superseded unified_sales candidate index is gone'
);

SELECT hasnt_index(
  'public', 'bank_transactions', 'idx_bank_transactions_rule_candidates',
  'superseded bank_transactions candidate index is gone'
);

-- ============================================================ RETRY REGRESSIONS
-- These pin the review-driven fix: statement 1 stamps rules_evaluated_at
-- BEFORE the matched rule is actually applied, so a per-row application
-- failure must reset the stamp back to '-infinity' -- otherwise the negative
-- cache would permanently hide a row whose failure was transient/fixable.

-- ---------------------------------------------------------------- TEST 28-29
-- POS split-failure retry: a split rule whose percentages don't sum to 100%
-- fails split_pos_sale's amount-equality check. The row must stay a
-- candidate, and once the rule is fixed, the next sweep must apply it.
INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009db', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-retry-split-1', 'Retry Split Item', 1, CURRENT_DATE, 100.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, is_split_rule,
   split_categories, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000009ff', '00000000-0000-0000-0000-0000000009a1',
   'Retry split (broken percentages)', 'pos_sales', '00000000-0000-0000-0000-0000000009c1',
   'Retry Split Item', 'exact', true, true, 50, true,
   jsonb_build_array(
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c1',
                        'percentage', 30, 'description', 'food'),
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c2',
                        'percentage', 30, 'description', 'other')),
   clock_timestamp())
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a1', 100);

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009db'),
  '-infinity'::timestamptz,
  'a split rule that fails split_pos_sale leaves the row as a retry candidate'
);

UPDATE categorization_rules
   SET split_categories = jsonb_build_array(
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c1',
                        'percentage', 60, 'description', 'food'),
     jsonb_build_object('category_id', '00000000-0000-0000-0000-0000000009c2',
                        'percentage', 40, 'description', 'other'))
 WHERE id = '00000000-0000-0000-0000-0000000009ff';

SELECT is(
  (SELECT applied_count FROM apply_rules_to_pos_sales_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'fixing the split rule lets the retained candidate apply on the next sweep'
);

-- ---------------------------------------------------------------- TEST 30-31
-- Bank exception retry: a rule pointing at an inactive category raises inside
-- the apply loop. The row must stay a candidate, and once the category is
-- reactivated, the next sweep must apply it.
INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype,
   normal_balance, is_active)
VALUES
  ('00000000-0000-0000-0000-0000000009c9', '00000000-0000-0000-0000-0000000009a1',
   'Retry Test Category', '4999', 'revenue', 'sales', 'credit', false)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount)
VALUES
  ('00000000-0000-0000-0000-0000000009e2', '00000000-0000-0000-0000-0000000009a1',
   '00000000-0000-0000-0000-0000000009b1', 'txn-retry-2', now(),
   'RETRY TEST VENDOR', -75.00)
ON CONFLICT (id) DO NOTHING;

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, description_pattern,
   description_match_type, is_active, auto_apply, priority, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000009fe', '00000000-0000-0000-0000-0000000009a1',
   'Retry bank rule (inactive category)', 'bank_transactions',
   '00000000-0000-0000-0000-0000000009c9', 'RETRY TEST VENDOR', 'exact',
   true, true, 60, clock_timestamp())
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_bank_transactions_internal(
  '00000000-0000-0000-0000-0000000009a1', 100);

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009e2'),
  '-infinity'::timestamptz,
  'a rule pointing at an inactive category leaves the row as a retry candidate'
);

UPDATE chart_of_accounts SET is_active = true
 WHERE id = '00000000-0000-0000-0000-0000000009c9';

SELECT is(
  (SELECT applied_count FROM apply_rules_to_bank_transactions_internal(
     '00000000-0000-0000-0000-0000000009a1', 100)),
  1,
  'reactivating the category lets the retained candidate apply on the next sweep'
);

-- ============================================================ AGGREGATION SUPPRESSION
-- Design spec test 8: the sweep must not recompute daily_sales when it
-- applies zero rows, and must recompute it (to the same total, since
-- aggregate_unified_sales_to_daily ignores category_id) when it applies one.
-- Isolated restaurant to avoid interference from the heavily-mutated state of
-- ...09a1 by this point in the file.
--
-- updated_at is transaction-frozen for the life of this pgTAP script (see
-- TEST 12's comment), so it cannot distinguish "recomputed with an identical
-- value" from "never touched". xmin can't either here: the whole script runs
-- inside one BEGIN/ROLLBACK transaction, so every write in this file carries
-- the same transaction id -- xmin captured before and after would be
-- identical regardless of whether the sweep touched the row. ctid (the
-- physical tuple version) changes on every UPDATE within a transaction, even
-- one that writes back identical values, so it's the one that actually
-- distinguishes "rewritten" from "left alone".
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-0000000009a2', 'Rescan Test Restaurant 2')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('00000000-0000-0000-0000-0000000009c3', '00000000-0000-0000-0000-0000000009a2',
   'Food Sales', '4000', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009da', '00000000-0000-0000-0000-0000000009a2',
   'toast', 'ord-agg-1', 'Unmatched Item', 1, CURRENT_DATE - 30, 12.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

-- Establish the baseline daily_sales row directly (not through the sweep) so
-- there is something whose ctid can be observed as unchanged.
SELECT aggregate_unified_sales_to_daily(
  '00000000-0000-0000-0000-0000000009a2', (CURRENT_DATE - 30));

SELECT set_config(
  'rescan_test.daily_sales_ctid',
  (SELECT ctid::text FROM daily_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a2'
      AND date = (CURRENT_DATE - 30) AND source = 'unified_pos'),
  true);

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority)
VALUES
  ('00000000-0000-0000-0000-0000000009fc', '00000000-0000-0000-0000-0000000009a2',
   'Never matches agg', 'pos_sales', '00000000-0000-0000-0000-0000000009c3',
   'zzz-no-such-item', 'exact', true, true, 10)
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a2', 100);

-- ---------------------------------------------------------------- TEST 32
SELECT is(
  (SELECT ctid::text FROM daily_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a2'
      AND date = (CURRENT_DATE - 30) AND source = 'unified_pos'),
  current_setting('rescan_test.daily_sales_ctid'),
  'a sweep that applies zero rows does not touch daily_sales'
);

INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, created_at)
VALUES
  ('00000000-0000-0000-0000-0000000009fd', '00000000-0000-0000-0000-0000000009a2',
   'Matches unmatched item', 'pos_sales', '00000000-0000-0000-0000-0000000009c3',
   'Unmatched Item', 'exact', true, true, 20, clock_timestamp())
ON CONFLICT (id) DO NOTHING;

SELECT applied_count FROM apply_rules_to_pos_sales_internal(
  '00000000-0000-0000-0000-0000000009a2', 100);

-- ---------------------------------------------------------------- TEST 33
-- ctid changing (as opposed to just gross_revenue matching, which TEST 34
-- checks) is the actual proof that the second sweep rewrote the row instead
-- of leaving the untouched baseline from TEST 32 in place.
SELECT isnt(
  (SELECT ctid::text FROM daily_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a2'
      AND date = (CURRENT_DATE - 30) AND source = 'unified_pos'),
  current_setting('rescan_test.daily_sales_ctid'),
  'a sweep that applies one row recomputes (rewrites) daily_sales'
);

-- ---------------------------------------------------------------- TEST 34
SELECT is(
  (SELECT gross_revenue FROM daily_sales
    WHERE restaurant_id = '00000000-0000-0000-0000-0000000009a2'
      AND date = (CURRENT_DATE - 30) AND source = 'unified_pos'),
  12.00::numeric,
  'a sweep that applies one row recomputes daily_sales to the same total (category_id is ignored)'
);

-- ============================================================ TRIGGER COVERAGE
-- TEST 3/4 above only exercised one match-input column per table
-- (item_name / amount). Cover the remaining match inputs the reset trigger
-- watches: total_price and pos_category for unified_sales; description and
-- supplier_id for bank_transactions. Fresh rows, isolated from the
-- heavily-mutated ...09d1/09e1 fixtures used earlier in this file.
INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity, sale_date,
   total_price, pos_category)
VALUES
  ('00000000-0000-0000-0000-0000000009dc', '00000000-0000-0000-0000-0000000009a1',
   'toast', 'ord-rescan-trigger', 'Trigger Coverage Item', 1, CURRENT_DATE, 9.00, 'Entrees')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- TEST 35
UPDATE unified_sales SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009dc';
UPDATE unified_sales SET total_price = 11.00
 WHERE id = '00000000-0000-0000-0000-0000000009dc';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009dc'),
  '-infinity'::timestamptz,
  'changing total_price resets unified_sales.rules_evaluated_at'
);

-- ---------------------------------------------------------------- TEST 36
UPDATE unified_sales SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009dc';
UPDATE unified_sales SET pos_category = 'Beverages'
 WHERE id = '00000000-0000-0000-0000-0000000009dc';

SELECT is(
  (SELECT rules_evaluated_at FROM unified_sales
    WHERE id = '00000000-0000-0000-0000-0000000009dc'),
  '-infinity'::timestamptz,
  'changing pos_category resets unified_sales.rules_evaluated_at'
);

INSERT INTO suppliers (id, restaurant_id, name)
VALUES
  ('00000000-0000-0000-0000-0000000009cf', '00000000-0000-0000-0000-0000000009a1',
   'Trigger Coverage Supplier')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions
  (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date,
   description, amount)
VALUES
  ('00000000-0000-0000-0000-0000000009eb', '00000000-0000-0000-0000-0000000009a1',
   '00000000-0000-0000-0000-0000000009b1', 'txn-rescan-trigger', now(),
   'Trigger Coverage Vendor', -50.00)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- TEST 37
UPDATE bank_transactions SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009eb';
UPDATE bank_transactions SET description = 'Renamed Vendor'
 WHERE id = '00000000-0000-0000-0000-0000000009eb';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009eb'),
  '-infinity'::timestamptz,
  'changing description resets bank_transactions.rules_evaluated_at'
);

-- ---------------------------------------------------------------- TEST 38
UPDATE bank_transactions SET rules_evaluated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000009eb';
UPDATE bank_transactions SET supplier_id = '00000000-0000-0000-0000-0000000009cf'
 WHERE id = '00000000-0000-0000-0000-0000000009eb';

SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions
    WHERE id = '00000000-0000-0000-0000-0000000009eb'),
  '-infinity'::timestamptz,
  'changing supplier_id resets bank_transactions.rules_evaluated_at'
);

-- ================================================================
-- Watermark self-invalidation and claim-based convergence.
--
-- The sweeps bump categorization_rules.apply_count/last_applied_at every time
-- a rule fires. If that bookkeeping advanced updated_at, it would advance the
-- rule watermark, and every row the same sweep had just stamped would compare
-- as stale on the next call -- the negative cache would never hold for any
-- restaurant whose rules actually match something.
--
-- Own restaurant so the many mutations above cannot perturb the watermark.
-- ================================================================
INSERT INTO restaurants (id, name) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a3', 'Watermark Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO chart_of_accounts
  (id, restaurant_id, account_name, account_code, account_type, account_subtype, normal_balance)
VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'Food Sales', '4000', 'revenue', 'sales', 'credit')
ON CONFLICT (id) DO NOTHING;

-- Dated in the past so "did updated_at advance?" is decidable inside a single
-- transaction: now() is fixed for the whole transaction, so a rule created here
-- with a default updated_at could never be observed to move.
INSERT INTO categorization_rules
  (id, restaurant_id, rule_name, applies_to, category_id, item_name_pattern,
   item_name_match_type, is_active, auto_apply, priority, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'Watermark rule', 'pos_sales', 'aaaaaaaa-0000-0000-0000-0000000000c1',
   'Match Me', 'exact', true, true, 10,
   '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- Suppress auto_categorize_pos_sale so the fixture rows arrive uncategorized
-- and the sweep below is the only thing that ever categorizes them.
SELECT set_config('app.skip_unified_sales_triggers', 'true', true);

INSERT INTO unified_sales
  (id, restaurant_id, pos_system, external_order_id, item_name, quantity,
   sale_date, total_price)
VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000d1', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'toast', 'ord-wm-1', 'Match Me', 1, CURRENT_DATE, 10.00),
  ('aaaaaaaa-0000-0000-0000-0000000000d2', 'aaaaaaaa-0000-0000-0000-0000000000a3',
   'toast', 'ord-wm-2', 'No Rule For Me', 1, CURRENT_DATE, 20.00)
ON CONFLICT (id) DO NOTHING;

SELECT set_config('app.skip_unified_sales_triggers', 'false', true);

-- ---------------------------------------------------------------- TEST 39
UPDATE categorization_rules
   SET apply_count = apply_count + 1, last_applied_at = now()
 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1';

SELECT is(
  (SELECT updated_at FROM categorization_rules
    WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1'),
  '2026-01-01T00:00:00Z'::timestamptz,
  'bumping apply_count/last_applied_at does not advance categorization_rules.updated_at'
);

-- ---------------------------------------------------------------- TEST 40-41
-- One sweep: claims both candidates, applies the one that matches.
CREATE TEMP TABLE wm_sweep_1 AS
  SELECT * FROM apply_rules_to_pos_sales_internal(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 100);

SELECT is(
  (SELECT total_count FROM wm_sweep_1),
  2,
  'total_count reports candidates CLAIMED (both rows), not rows matched'
);

SELECT is(
  (SELECT applied_count FROM wm_sweep_1),
  1,
  'applied_count reports only the row an active rule matched'
);

-- ---------------------------------------------------------------- TEST 42
-- The load-bearing assertion: the previous sweep bumped apply_count on a rule
-- it applied. If that had advanced updated_at, the watermark would now exceed
-- the stamp the same sweep wrote and both rows would be claimed all over again.
CREATE TEMP TABLE wm_sweep_2 AS
  SELECT * FROM apply_rules_to_pos_sales_internal(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 100);

SELECT is(
  (SELECT total_count FROM wm_sweep_2),
  0,
  'a sweep that applied a rule does not re-open its own stamped rows'
);

-- ---------------------------------------------------------------- TEST 43
-- The other half of the invariant: a genuine definition change must still
-- advance the watermark, or edited rules would never be re-applied.
UPDATE categorization_rules
   SET rule_name = 'Watermark rule (renamed)'
 WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1';

SELECT ok(
  (SELECT updated_at FROM categorization_rules
    WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000f1')
  > '2026-01-01T00:00:00Z'::timestamptz,
  'a rule-definition change still advances categorization_rules.updated_at'
);

-- ---------------------------------------------------------------- TEST 44
CREATE TEMP TABLE wm_sweep_3 AS
  SELECT * FROM apply_rules_to_pos_sales_internal(
    'aaaaaaaa-0000-0000-0000-0000000000a3', 100);

SELECT is(
  (SELECT total_count FROM wm_sweep_3),
  1,
  'editing a rule re-opens the still-uncategorized row for evaluation'
);

SELECT * FROM finish();
ROLLBACK;
