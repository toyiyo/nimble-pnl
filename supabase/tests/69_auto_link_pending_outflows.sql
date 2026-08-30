-- Tests for auto_link_pending_outflows_internal and normalize_match_text.
-- Migration: 20260830100000_auto_link_pending_outflows.sql
-- Design: docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
--         sections 5, 6, 10.
--
-- All fixtures share one restaurant. Each scenario uses a distinct dollar
-- amount so scenarios never tie against each other inside the same call.

BEGIN;
SELECT plan(39);

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

-- normalize_match_text --------------------------------------------------------
SELECT is(normalize_match_text('Sysco Foods, LLC.'), 'syscofoodsllc', 'normalize_match_text lowercases and strips punctuation');
SELECT is(normalize_match_text(NULL), '', 'normalize_match_text of NULL is empty string');
SELECT is(normalize_match_text('ACME #123'), 'acme123', 'normalize_match_text keeps digits');

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
SELECT is((SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000069915'::uuid), 'pending', 'already-categorized transaction: outflow stays pending');
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
