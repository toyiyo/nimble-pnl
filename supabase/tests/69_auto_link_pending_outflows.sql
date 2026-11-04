-- Tests for auto_link_pending_outflows_internal and normalize_match_text.
-- Migration: 20260830100000_auto_link_pending_outflows.sql
-- Design: docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
--         sections 5, 6, 10.
--
-- All fixtures share one restaurant. Each scenario uses a distinct dollar
-- amount so scenarios never tie against each other inside the same call.

BEGIN;
SELECT plan(92);

SET LOCAL role TO postgres;

-- Fixtures -------------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000069000'::uuid, 'Auto-Link Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000069001'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000069002'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '6000', 'Food Cost', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000069003'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '6001', 'Inactive Category', 'expense', 'operating_expenses', 'debit', false)
ON CONFLICT (id) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000069010'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'fa_test_autolink_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Closed period covering 2026-05-01..2026-05-31, used by the closed-period test.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000069020'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   DATE '2026-05-01', DATE '2026-05-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

-- Second active category, used by the categorized-eligibility scenarios
-- (Case C category mismatch, the bulk-categorize marker scenario).
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000069004'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '6002', 'Repairs Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

-- Owner user, used by unlink_pending_outflow and bulk_categorize_bank_transactions
-- calls below (both require an authenticated caller with restaurant access).
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000069090'::uuid, 'autolink-owner@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000069090'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- normalize_match_text --------------------------------------------------------
SELECT is(normalize_match_text('Sysco Foods, LLC.'), 'syscofoodsllc', 'normalize_match_text lowercases and strips punctuation');
SELECT is(normalize_match_text(NULL), '', 'normalize_match_text of NULL is empty string');
SELECT is(normalize_match_text('ACME #123'), 'acme123', 'normalize_match_text keeps digits');

-- normalize_match_tokens and vendor_text_match ---------------------------------
SELECT is(normalize_match_tokens('Sysco Foods, LLC.'), 'sysco foods llc', 'normalize_match_tokens keeps word boundaries');
SELECT is(normalize_match_tokens(NULL), '', 'normalize_match_tokens of NULL is empty string');
SELECT is(vendor_text_match('Sysco', 'SYSCO FOODS 8812'), true, 'vendor_text_match: 5-char string matches by plain containment');
SELECT is(vendor_text_match('Cox', 'RENT AND COX 4411'), true, 'vendor_text_match: 3-char string matches at a token boundary');
SELECT is(vendor_text_match('Dco', 'RENT AND COX 4411'), false, 'vendor_text_match: 3-char string does not match across a word boundary');
SELECT is(vendor_text_match('AB', 'AB SUPPLY'), false, 'vendor_text_match: a 2-char string never matches');

-- Scenario 1: happy path WITH category ----------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status, notes) VALUES
  ('00000000-0000-0000-0000-000000069101'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Sysco Foods LLC', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 111.11, DATE '2026-01-01', 'pending', 'PO note');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled, notes) VALUES
  ('00000000-0000-0000-0000-000000069102'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-happy-cat',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.11, 'SYSCO FOODS 8812', 'SYSCO', 'posted', false, false, false, false, 'BT note');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069101'::uuid),
  'cleared', 'happy path (category): outflow clears');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069101'::uuid),
  '00000000-0000-0000-0000-000000069102'::uuid, 'happy path (category): outflow links to the transaction');
SELECT isnt(
  (SELECT auto_linked_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069101'::uuid),
  NULL, 'happy path (category): auto_linked_at is set');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069102'::uuid),
  true, 'happy path (category): transaction is categorized');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069102'::uuid),
  '00000000-0000-0000-0000-000000069002'::uuid, 'happy path (category): transaction category matches outflow category');
SELECT is(
  (SELECT notes FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069102'::uuid),
  'BT note' || E'\n\n' || 'PO note', 'happy path (category): notes merged');
SELECT is(
  (SELECT matched_by FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069102'::uuid),
  NULL, 'happy path (category): matched_by is NULL (background writer)');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069102'::uuid),
  1, 'happy path (category): exactly one journal entry');
SELECT is(
  (SELECT count(*)::int FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.journal_entry_id
   WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000069102'::uuid),
  2, 'happy path (category): two journal lines');

-- Scenario 2: happy path WITHOUT category --------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069201'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Acme Produce', NULL, 'check', 222.22, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069202'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-happy-nocat',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -222.22, 'ACME PRODUCE CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069201'::uuid),
  'cleared', 'happy path (no category): outflow clears');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069202'::uuid),
  false, 'happy path (no category): transaction stays uncategorized');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069202'::uuid),
  0, 'happy path (no category): no journal entry created');

-- Scenario 3: two outflows tie for one transaction -----------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069301'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Tie Vendor', 'ach', 333.33, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069302'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Tie Vendor', 'ach', 333.33, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069303'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-tie-po',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -333.33, 'TIE VENDOR INC', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069301'::uuid),
  'pending', 'two-outflows tie: first outflow stays pending');
SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069302'::uuid),
  'pending', 'two-outflows tie: second outflow stays pending');

-- Scenario 4: two transactions tie for one outflow -----------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069401'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Dup Vendor', 'ach', 444.44, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069402'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-tie-bt1',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -444.44, 'DUP VENDOR', NULL, 'posted', false, false, false, false),
  ('00000000-0000-0000-0000-000000069403'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-tie-bt2',
   TIMESTAMPTZ '2026-01-06 12:00:00+00', -444.44, 'DUP VENDOR', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069401'::uuid),
  'pending', 'two-transactions tie: outflow stays pending');

-- Scenario 5: vendor mismatch ---------------------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069501'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Totally Different Co', 'ach', 555.55, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069502'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-vendor-mismatch',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -555.55, 'Nonmatching Name Ltd', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069501'::uuid),
  'pending', 'vendor mismatch: outflow stays pending');

-- Scenario 6: amount off by $0.02 ------------------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069601'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Close Amount Co', 'ach', 666.66, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069602'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-amount-off',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -666.68, 'CLOSE AMOUNT CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069601'::uuid),
  'pending', 'amount off by $0.02: outflow stays pending');

-- Scenario 7: posting outside the 14-day forward window (too late) --------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069701'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Late Post Co', 'ach', 777.77, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069702'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-too-late',
   TIMESTAMPTZ '2026-01-16 12:00:00+00', -777.77, 'LATE POST CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069701'::uuid),
  'pending', 'posting outside 14-day window: outflow stays pending');

-- Scenario 8: posting before the issue date --------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069801'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Early Post Co', 'ach', 888.88, DATE '2026-01-10', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069802'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-too-early',
   TIMESTAMPTZ '2026-01-09 12:00:00+00', -888.88, 'EARLY POST CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069801'::uuid),
  'pending', 'posting before issue date: outflow stays pending');

-- Scenario 9: transaction-side flags (transfer/split/excluded/reconciled/categorized/already-linked)
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069911'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor A', 'ach', 111.01, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069912'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor B', 'ach', 111.02, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069913'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor C', 'ach', 111.03, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069914'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor D', 'ach', 111.04, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069915'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor E', 'ach', 111.05, DATE '2026-01-01', 'pending'),
  ('00000000-0000-0000-0000-000000069916'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor F', 'ach', 111.06, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069921'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-transfer',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.01, 'FLAG VENDOR A', NULL, 'posted', false, true, false, false),
  ('00000000-0000-0000-0000-000000069922'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-split',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.02, 'FLAG VENDOR B', NULL, 'posted', false, false, true, false),
  ('00000000-0000-0000-0000-000000069924'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-reconciled',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.04, 'FLAG VENDOR D', NULL, 'posted', false, false, false, true),
  ('00000000-0000-0000-0000-000000069925'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-categorized',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.05, 'FLAG VENDOR E', NULL, 'posted', true, false, false, false);

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled, excluded_reason) VALUES
  ('00000000-0000-0000-0000-000000069923'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-excluded',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.03, 'FLAG VENDOR C', NULL, 'posted', false, false, false, false, 'duplicate');

-- Already-linked: a distinct, already-cleared outflow claims this transaction first.
INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069926'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-flag-already-linked',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -111.06, 'FLAG VENDOR F', NULL, 'posted', false, false, false, false);

INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status, linked_bank_transaction_id, cleared_at) VALUES
  ('00000000-0000-0000-0000-000000069917'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Flag Vendor F Prior', 'ach', 111.06, DATE '2026-01-01', 'cleared',
   '00000000-0000-0000-0000-000000069926'::uuid, now());

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069911'::uuid), 'pending', 'transfer transaction: outflow stays pending');
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069912'::uuid), 'pending', 'split transaction: outflow stays pending');
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069913'::uuid), 'pending', 'excluded transaction: outflow stays pending');
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069914'::uuid), 'pending', 'reconciled transaction: outflow stays pending');
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069915'::uuid), 'pending', 'categorized transaction without journal entry: outflow stays pending');
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069916'::uuid), 'pending', 'already-linked transaction: new outflow stays pending');

-- Scenario 10: outflow-side status (cleared / voided) already excludes it --------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069931'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Already Cleared Co', 'ach', 222.01, DATE '2026-01-01', 'cleared'),
  ('00000000-0000-0000-0000-000000069932'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, 'Voided Co', 'ach', 222.02, DATE '2026-01-01', 'voided');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069933'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-outflow-cleared',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -222.01, 'ALREADY CLEARED CO', NULL, 'posted', false, false, false, false),
  ('00000000-0000-0000-0000-000000069934'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-outflow-voided',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -222.02, 'VOIDED CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is((SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069933'::uuid), false, 'already-cleared outflow: matching transaction stays uncategorized');
SELECT is((SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069934'::uuid), false, 'voided outflow: matching transaction stays uncategorized');

-- Scenario 11: notes-merge idempotence on a second call --------------------------
-- Reset scenario 2's pair back to open (simulating an out-of-band unlink,
-- since unlink_pending_outflow does not exist until the next migration) and
-- re-run. The bank notes already carry the merged text, so the second pass
-- must not duplicate it.
UPDATE pending_outflows
SET status = 'pending', linked_bank_transaction_id = NULL, cleared_at = NULL, auto_linked_at = NULL
WHERE id = '00000000-0000-0000-0000-000000069201'::uuid;

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069201'::uuid),
  'cleared', 'notes-merge idempotence: outflow re-links on the second pass');
SELECT is(
  (SELECT notes FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069202'::uuid),
  NULL, 'notes-merge idempotence: no notes to merge (outflow had none), still NULL');

-- Scenario 12: closed fiscal period skips the pair --------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069951'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Closed Period Co', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 999.99, DATE '2026-05-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069952'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-closed-period',
   TIMESTAMPTZ '2026-05-05 12:00:00+00', -999.99, 'CLOSED PERIOD CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069951'::uuid),
  'pending', 'closed fiscal period: outflow stays pending, pair skipped');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069952'::uuid),
  0, 'closed fiscal period: no journal entry created');

-- Scenario 13: p_skip_rebuild = true leaves chart_of_accounts.current_balance unchanged
UPDATE chart_of_accounts SET current_balance = 0 WHERE id = '00000000-0000-0000-0000-000000069002'::uuid;

INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069961'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Skip Rebuild Co', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 123.45, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069962'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-skip-rebuild',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -123.45, 'SKIP REBUILD CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid, 100, true);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069961'::uuid),
  'cleared', 'p_skip_rebuild=true: the pair still links');
SELECT is(
  (SELECT current_balance FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000069002'::uuid),
  0::numeric, 'p_skip_rebuild=true: current_balance is not rebuilt');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid, 100, false);

-- Scenario 14: short vendor (3 chars) links at a token boundary -------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069971'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'UPS', 'ach', 271.82, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069972'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-short-token',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -271.82, 'UPS BILL PAYMENT', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069971'::uuid),
  'cleared', 'short vendor at token boundary: outflow clears');

-- Scenario 15: short vendor across a word boundary does not link ------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069981'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Dco', 'ach', 314.15, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069982'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-cross-word',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -314.15, 'RENT AND COX 4411', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069981'::uuid),
  'pending', 'short vendor across a word boundary: outflow stays pending');

-- Scenario 16: Case A -- categorized transaction, journal entry exists,
-- categories agree -- link only, journal entry untouched (design §6).
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status, notes) VALUES
  ('00000000-0000-0000-0000-000000069110'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Case A Vendor', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 1601.60, CURRENT_DATE - 1, 'pending', 'PO note A');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, category_id, is_transfer, is_split, is_reconciled, notes) VALUES
  ('00000000-0000-0000-0000-000000069111'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-case-a',
   now(), -1601.60, 'CASE A VENDOR 001', NULL, 'posted', true, '00000000-0000-0000-0000-000000069002'::uuid, false, false, false, 'BT note A');

INSERT INTO journal_entries (id, restaurant_id, entry_date, entry_number, description, reference_type, reference_id, total_debit, total_credit) VALUES
  ('00000000-0000-0000-0000-000000069112'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, CURRENT_DATE,
   'RULE-CASE-A-001', 'Pre-existing categorization A', 'bank_transaction', '00000000-0000-0000-0000-000000069111'::uuid, 1601.60, 1601.60);

INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000069113'::uuid, '00000000-0000-0000-0000-000000069112'::uuid, '00000000-0000-0000-0000-000000069002'::uuid, 1601.60, 0, 'Food Cost'),
  ('00000000-0000-0000-0000-000000069114'::uuid, '00000000-0000-0000-0000-000000069112'::uuid, '00000000-0000-0000-0000-000000069001'::uuid, 0, 1601.60, 'Cash payment');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  'cleared', 'Case A: outflow clears');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  '00000000-0000-0000-0000-000000069111'::uuid, 'Case A: outflow links to the transaction');
SELECT is(
  (SELECT category_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  '00000000-0000-0000-0000-000000069002'::uuid, 'Case A: outflow category is unchanged (already agreed)');
SELECT isnt(
  (SELECT matched_at FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069111'::uuid),
  NULL, 'Case A: matched_at is set');
SELECT is(
  (SELECT notes FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069111'::uuid),
  'BT note A' || E'\n\n' || 'PO note A', 'Case A: notes merged');
SELECT is(
  (SELECT id FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069111'::uuid),
  '00000000-0000-0000-0000-000000069112'::uuid, 'Case A: journal entry id is unchanged (same id)');
SELECT is(
  (SELECT description FROM journal_entries WHERE id = '00000000-0000-0000-0000-000000069112'::uuid),
  'Pre-existing categorization A', 'Case A: journal entry description is untouched');
SELECT is(
  (SELECT count(*)::int FROM journal_entry_lines WHERE journal_entry_id = '00000000-0000-0000-0000-000000069112'::uuid),
  2, 'Case A: journal entry line count is unchanged');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069111'::uuid),
  '00000000-0000-0000-0000-000000069002'::uuid, 'Case A: transaction category_id is unchanged');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069111'::uuid),
  true, 'Case A: transaction stays categorized');

-- Scenario 17: unlink after a Case A link -- kept category, entry survives
-- (reuses the Case A fixtures above, design §6).
SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000069090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000069110'::uuid)->>'category_kept')::boolean,
  true, 'unlink after Case A: category_kept is true');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069111'::uuid),
  1, 'unlink after Case A: journal entry survives');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069111'::uuid),
  true, 'unlink after Case A: transaction stays categorized');
SELECT isnt(
  (SELECT auto_link_suppressed_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  NULL, 'unlink after Case A: auto_link_suppressed_at is set');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  NULL, 'unlink after Case A: outflow unlinked');
SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069110'::uuid),
  'pending', 'unlink after Case A: status recomputes to pending for a recent issue_date');

SET LOCAL role TO postgres;

-- Scenario 18: Case B -- categorized transaction, journal entry exists,
-- outflow has no category -- link and copy the category (design §6).
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069130'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Case B Vendor', NULL, 'ach', 1701.70, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, category_id, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069131'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-case-b',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -1701.70, 'CASE B VENDOR 002', NULL, 'posted', true, '00000000-0000-0000-0000-000000069002'::uuid, false, false, false);

INSERT INTO journal_entries (id, restaurant_id, entry_date, entry_number, description, reference_type, reference_id, total_debit, total_credit) VALUES
  ('00000000-0000-0000-0000-000000069132'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, DATE '2026-01-05',
   'RULE-CASE-B-001', 'Pre-existing categorization B', 'bank_transaction', '00000000-0000-0000-0000-000000069131'::uuid, 1701.70, 1701.70);

INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000069133'::uuid, '00000000-0000-0000-0000-000000069132'::uuid, '00000000-0000-0000-0000-000000069002'::uuid, 1701.70, 0, 'Food Cost'),
  ('00000000-0000-0000-0000-000000069134'::uuid, '00000000-0000-0000-0000-000000069132'::uuid, '00000000-0000-0000-0000-000000069001'::uuid, 0, 1701.70, 'Cash payment');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069130'::uuid),
  'cleared', 'Case B: outflow clears');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069130'::uuid),
  '00000000-0000-0000-0000-000000069131'::uuid, 'Case B: outflow links to the transaction');
SELECT is(
  (SELECT category_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069130'::uuid),
  '00000000-0000-0000-0000-000000069002'::uuid, 'Case B: outflow receives the transaction category');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069131'::uuid),
  1, 'Case B: journal entry count is unchanged');

-- Scenario 19: Case C -- categorized transaction, journal entry exists,
-- categories disagree -- not linkable, no writes (design §6).
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069150'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Case C Vendor', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 1801.80, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, category_id, is_transfer, is_split, is_reconciled, notes) VALUES
  ('00000000-0000-0000-0000-000000069151'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-case-c',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -1801.80, 'CASE C VENDOR 003', NULL, 'posted', true, '00000000-0000-0000-0000-000000069004'::uuid, false, false, false, 'BT note C');

INSERT INTO journal_entries (id, restaurant_id, entry_date, entry_number, description, reference_type, reference_id, total_debit, total_credit) VALUES
  ('00000000-0000-0000-0000-000000069152'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, DATE '2026-01-05',
   'RULE-CASE-C-001', 'Pre-existing categorization C', 'bank_transaction', '00000000-0000-0000-0000-000000069151'::uuid, 1801.80, 1801.80);

INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000069153'::uuid, '00000000-0000-0000-0000-000000069152'::uuid, '00000000-0000-0000-0000-000000069004'::uuid, 1801.80, 0, 'Repairs Expense'),
  ('00000000-0000-0000-0000-000000069154'::uuid, '00000000-0000-0000-0000-000000069152'::uuid, '00000000-0000-0000-0000-000000069001'::uuid, 0, 1801.80, 'Cash payment');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069150'::uuid),
  'pending', 'Case C: outflow stays pending');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069150'::uuid),
  NULL, 'Case C: outflow stays unlinked');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069151'::uuid),
  '00000000-0000-0000-0000-000000069004'::uuid, 'Case C: transaction category is unchanged');
SELECT is(
  (SELECT notes FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069151'::uuid),
  'BT note C', 'Case C: transaction notes are untouched (pair is not linkable, no writes)');

-- Scenario 20: uniqueness counts a categorized twin (design §4.1) -- a
-- categorized transaction now counts toward the tie, so the outflow
-- stays pending even though one twin is uncategorized and unique-eligible
-- under the old predicate.
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069161'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Tie Categorized Co', 'ach', 1901.90, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, category_id, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069162'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-tie-cat-a',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -1901.90, 'TIE CATEGORIZED CO A', NULL, 'posted', true, '00000000-0000-0000-0000-000000069002'::uuid, false, false, false),
  ('00000000-0000-0000-0000-000000069163'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-tie-cat-b',
   TIMESTAMPTZ '2026-01-06 12:00:00+00', -1901.90, 'TIE CATEGORIZED CO B', NULL, 'posted', false, NULL, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069161'::uuid),
  'pending', 'uniqueness counts a categorized twin: outflow stays pending');

-- Scenario 21: unlink after an original-path link -- the auto-link wrote
-- the entry itself, so the marker check passes and the revert still
-- works (category_kept = false, design §6).
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069180'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Original Path Co', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 2101.21, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069181'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-original-path',
   now(), -2101.21, 'ORIGINAL PATH CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069180'::uuid),
  'cleared', 'original-path setup: auto-link cleared the outflow');
SELECT is(
  (SELECT description FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069181'::uuid),
  'Matched pending outflow: Original Path Co', 'original-path setup: the auto-link wrote the marker description');

SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000069090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000069180'::uuid)->>'category_kept')::boolean,
  false, 'unlink after original-path link: category_kept is false, the marker pins the revert');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069181'::uuid),
  0, 'unlink after original-path link: journal entry is deleted');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069181'::uuid),
  false, 'unlink after original-path link: transaction is uncategorized');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069180'::uuid),
  NULL, 'unlink after original-path link: outflow unlinked');
SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069180'::uuid),
  'pending', 'unlink after original-path link: status recomputes to pending');

SET LOCAL role TO postgres;

-- Scenario 22: rebuild skip on a Case-A-only call -- a call that
-- produces only a Case A link leaves current_balance unchanged, mirroring
-- scenario 13 for the categorized-eligibility path (design §6).
UPDATE chart_of_accounts SET current_balance = 0 WHERE id = '00000000-0000-0000-0000-000000069002'::uuid;

INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069191'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Rebuild Skip Cat Co', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 2201.22, DATE '2026-01-01', 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, category_id, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069192'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-rebuild-skip-cat',
   TIMESTAMPTZ '2026-01-05 12:00:00+00', -2201.22, 'REBUILD SKIP CAT CO', NULL, 'posted', true, '00000000-0000-0000-0000-000000069002'::uuid, false, false, false);

INSERT INTO journal_entries (id, restaurant_id, entry_date, entry_number, description, reference_type, reference_id, total_debit, total_credit) VALUES
  ('00000000-0000-0000-0000-000000069193'::uuid, '00000000-0000-0000-0000-000000069000'::uuid, DATE '2026-01-05',
   'RULE-REBUILD-SKIP-001', 'Pre-existing categorization D', 'bank_transaction', '00000000-0000-0000-0000-000000069192'::uuid, 2201.22, 2201.22);

INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit_amount, credit_amount, description) VALUES
  ('00000000-0000-0000-0000-000000069194'::uuid, '00000000-0000-0000-0000-000000069193'::uuid, '00000000-0000-0000-0000-000000069002'::uuid, 2201.22, 0, 'Food Cost'),
  ('00000000-0000-0000-0000-000000069195'::uuid, '00000000-0000-0000-0000-000000069193'::uuid, '00000000-0000-0000-0000-000000069001'::uuid, 0, 2201.22, 'Cash payment');

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid, 100, false);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069191'::uuid),
  'cleared', 'rebuild skip (Case A only): the pair still links');
SELECT is(
  (SELECT current_balance FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000069002'::uuid),
  0::numeric, 'rebuild skip (Case A only): current_balance is not rebuilt');

-- Scenario 23: the marker survives bulk_categorize_bank_transactions --
-- the reclassification branch does not touch the original entry, and the
-- resulting category mismatch (not the marker) blocks the later unlink
-- from reverting a category bulk_categorize now owns (design §6,
-- supabase-design-review finding).
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000069203'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   'Bulk Marker Co', '00000000-0000-0000-0000-000000069002'::uuid, 'ach', 2301.23, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000069204'::uuid, '00000000-0000-0000-0000-000000069000'::uuid,
   '00000000-0000-0000-0000-000000069010'::uuid, 'txn-autolink-bulk-marker',
   now(), -2301.23, 'BULK MARKER CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000069000'::uuid);

SELECT is(
  (SELECT description FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069204'::uuid),
  'Matched pending outflow: Bulk Marker Co', 'bulk-categorize marker setup: the auto-link wrote the marker description');

SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000069090","role":"authenticated"}', true);

SELECT is(
  (SELECT (bulk_categorize_bank_transactions(
     ARRAY['00000000-0000-0000-0000-000000069204'::uuid],
     '00000000-0000-0000-0000-000000069004'::uuid,
     '00000000-0000-0000-0000-000000069000'::uuid,
     false
   )->>'reclassified_count')::int),
  1, 'bulk-categorize marker: reclassifies the auto-linked transaction');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069204'::uuid),
  '00000000-0000-0000-0000-000000069004'::uuid, 'bulk-categorize marker: transaction category changes');
SELECT is(
  (SELECT description FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069204'::uuid),
  'Matched pending outflow: Bulk Marker Co', 'bulk-categorize marker: the reclassification branch leaves the original entry untouched');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069204'::uuid),
  1, 'bulk-categorize marker: no duplicate bank_transaction entry');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'reclassification' AND entry_number LIKE 'RECLASS-00000000-0000-0000-0000-000000069204-%'),
  1, 'bulk-categorize marker: a separate reclassification entry is inserted');

SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000069090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000069203'::uuid)->>'category_kept')::boolean,
  true, 'bulk-categorize marker: unlink keeps the category (mismatch blocks the revert, not the marker)');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000069204'::uuid),
  1, 'bulk-categorize marker: unlink does not delete the marked entry');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000069204'::uuid),
  '00000000-0000-0000-0000-000000069004'::uuid, 'bulk-categorize marker: unlink leaves the bulk-categorized category in place');

SET LOCAL role TO postgres;

-- Structural pin: the post-claim re-validation recomputes journal-entry
-- existence and category agreement on the locked rows (design §6, same
-- technique as supabase/tests/51_standing_categorization_sweep.sql tests
-- 8 and 10). pgTAP cannot pause a function mid-transaction to test the
-- claim-window race behaviourally, so this pins the code structurally.
SELECT ok(
  regexp_replace(
    regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
    '--[^\n]*', '', 'g'
  ) ILIKE '%v_bt.is_categorized THEN%journal_entries%reference_id = v_bt.id%',
  'auto_link_pending_outflows_internal rechecks journal-entry existence on the locked transaction after the claim'
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'auto_link_pending_outflows_internal';

SELECT ok(
  regexp_replace(
    regexp_replace(pg_get_functiondef(p.oid), '/\*.*?\*/', '', 'gs'),
    '--[^\n]*', '', 'g'
  ) ILIKE '%v_po.category_id IS NOT NULL AND v_po.category_id IS DISTINCT FROM v_bt.category_id%',
  'auto_link_pending_outflows_internal rechecks category agreement on the locked rows after the claim'
)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'auto_link_pending_outflows_internal';

-- Grants -------------------------------------------------------------------------
SELECT ok(
  NOT has_function_privilege('anon', 'public.auto_link_pending_outflows_internal(uuid, integer, boolean)', 'EXECUTE'),
  'anon cannot execute auto_link_pending_outflows_internal (PUBLIC revoked)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.auto_link_pending_outflows_internal(uuid, integer, boolean)', 'EXECUTE'),
  'authenticated cannot execute auto_link_pending_outflows_internal');
SELECT ok(
  has_function_privilege('service_role', 'public.auto_link_pending_outflows_internal(uuid, integer, boolean)', 'EXECUTE'),
  'service_role can execute auto_link_pending_outflows_internal');

SELECT * FROM finish();
ROLLBACK;
