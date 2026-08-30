-- Tests for unlink_pending_outflow.
-- Migration: 20260830100100_unlink_pending_outflow.sql
-- Design: docs/superpowers/specs/2026-08-30-pending-outflow-auto-link-design.md
--         section 7.
--
-- All fixtures share one restaurant. Each scenario uses a distinct dollar
-- amount so auto-link candidate pairs never tie against each other.

BEGIN;
SELECT plan(33);

SET LOCAL role TO postgres;

-- Fixtures -------------------------------------------------------------------
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000070000'::uuid, 'Unlink Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000070001'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000070002'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, '6000', 'Food Cost', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000070003'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, '6001', 'Repairs Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET is_active = true;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000070010'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, 'fa_test_unlink_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000070090'::uuid, 'unlink-owner@example.com'),
  ('00000000-0000-0000-0000-000000070091'::uuid, 'unlink-manager@example.com'),
  ('00000000-0000-0000-0000-000000070092'::uuid, 'unlink-staff@example.com'),
  ('00000000-0000-0000-0000-000000070093'::uuid, 'unlink-outsider@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000070090'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, 'owner'),
  ('00000000-0000-0000-0000-000000070091'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, 'manager'),
  ('00000000-0000-0000-0000-000000070092'::uuid, '00000000-0000-0000-0000-000000070000'::uuid, 'staff')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Scenario A: full revert -----------------------------------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000070101'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Sysco Foods LLC', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 111.11, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070102'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-revert',
   now(), -111.11, 'SYSCO FOODS 8812', 'SYSCO', 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  'cleared', 'scenario A setup: auto-link cleared the outflow');

SET LOCAL role TO postgres;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070101'::uuid)->>'category_kept')::boolean,
  false, 'full revert: category_kept is false');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000070102'::uuid),
  0, 'full revert: journal entry is deleted');
SELECT is(
  (SELECT count(*)::int FROM journal_entry_lines jel
   WHERE jel.journal_entry_id NOT IN (SELECT id FROM journal_entries)),
  0, 'full revert: no orphaned journal entry lines remain');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  false, 'full revert: transaction is uncategorized');
SELECT is(
  (SELECT category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  NULL, 'full revert: category_id cleared');
SELECT is(
  (SELECT suggested_category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  NULL, 'full revert: suggested_category_id cleared');
SELECT is(
  (SELECT rules_evaluated_at FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  '-infinity'::timestamptz, 'full revert: rules_evaluated_at reset to -infinity so the sweep can reclaim it');
SELECT is(
  (SELECT matched_at FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  NULL, 'full revert: matched_at cleared');
SELECT is(
  (SELECT matched_by FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070102'::uuid),
  NULL, 'full revert: matched_by cleared');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  NULL, 'full revert: outflow unlinked');
SELECT is(
  (SELECT cleared_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  NULL, 'full revert: cleared_at cleared');
SELECT is(
  (SELECT auto_linked_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  NULL, 'full revert: auto_linked_at cleared');
SELECT isnt(
  (SELECT auto_link_suppressed_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  NULL, 'full revert: auto_link_suppressed_at is set');
SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  'pending', 'full revert: status recomputes to pending for a recent issue_date');

-- Scenario A continued: a second internal-function run does not re-link ------
SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  NULL, 'suppression: a second internal-function run does not re-link the suppressed pair');
SELECT is(
  (SELECT status FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070101'::uuid),
  'pending', 'suppression: outflow stays pending after the second run');

-- Scenario B: transaction reconciled after the link ---------------------------
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000070201'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Acme Produce', '00000000-0000-0000-0000-000000070002'::uuid, 'check', 222.22, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070202'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-reconciled',
   now(), -222.22, 'ACME PRODUCE CO', NULL, 'posted', false, false, false, false);

SET LOCAL role TO postgres;
SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

UPDATE bank_transactions SET is_reconciled = true WHERE id = '00000000-0000-0000-0000-000000070202'::uuid;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070201'::uuid)->>'category_kept')::boolean,
  true, 'reconciled: category_kept is true');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000070202'::uuid),
  1, 'reconciled: journal entry is kept');
SELECT is(
  (SELECT is_categorized FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070202'::uuid),
  true, 'reconciled: transaction stays categorized');
SELECT is(
  (SELECT matched_at FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000070202'::uuid),
  NULL, 'reconciled: match metadata is still cleared');
SELECT is(
  (SELECT linked_bank_transaction_id FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070201'::uuid),
  NULL, 'reconciled: outflow is still unlinked');
SELECT isnt(
  (SELECT auto_link_suppressed_at FROM pending_outflows WHERE id = '00000000-0000-0000-0000-000000070201'::uuid),
  NULL, 'reconciled: auto_link_suppressed_at is still set');

-- Scenario C: category changed after the link ---------------------------------
SET LOCAL role TO postgres;
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000070301'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Reliable Repairs', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 333.33, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070302'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-recategorized',
   now(), -333.33, 'RELIABLE REPAIRS CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

-- Simulate a manual reclassification after the auto-link.
UPDATE bank_transactions SET category_id = '00000000-0000-0000-0000-000000070003'::uuid
  WHERE id = '00000000-0000-0000-0000-000000070302'::uuid;

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070301'::uuid)->>'category_kept')::boolean,
  true, 'recategorized: category_kept is true when the category changed after the link');
SELECT is(
  (SELECT count(*)::int FROM journal_entries WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000070302'::uuid),
  1, 'recategorized: journal entry is kept');

-- Scenario D: membership guard --------------------------------------------------
SET LOCAL role TO postgres;
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000070401'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Guard Test Co', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 444.44, CURRENT_DATE - 1, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070402'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-guard',
   now(), -444.44, 'GUARD TEST CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070093","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT unlink_pending_outflow('00000000-0000-0000-0000-000000070401'::uuid)$$,
  'Unauthorized: user does not have access to this restaurant',
  'membership guard: an outsider cannot unlink');

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070092","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT unlink_pending_outflow('00000000-0000-0000-0000-000000070401'::uuid)$$,
  'Unauthorized: user does not have access to this restaurant',
  'membership guard: a staff role cannot unlink');

-- Scenario E: stale status recompute from issue_date age -----------------------
SET LOCAL role TO postgres;
INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status) VALUES
  ('00000000-0000-0000-0000-000000070501'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Stale 31 Co', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 551.00, CURRENT_DATE - 31, 'pending'),
  ('00000000-0000-0000-0000-000000070511'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Stale 61 Co', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 561.00, CURRENT_DATE - 61, 'pending'),
  ('00000000-0000-0000-0000-000000070521'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Stale 91 Co', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 571.00, CURRENT_DATE - 91, 'pending');

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070502'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-stale-31',
   (CURRENT_DATE - 29)::timestamptz + interval '12 hours', -551.00, 'STALE 31 CO', NULL, 'posted', false, false, false, false),
  ('00000000-0000-0000-0000-000000070512'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-stale-61',
   (CURRENT_DATE - 59)::timestamptz + interval '12 hours', -561.00, 'STALE 61 CO', NULL, 'posted', false, false, false, false),
  ('00000000-0000-0000-0000-000000070522'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   '00000000-0000-0000-0000-000000070010'::uuid, 'txn-unlink-stale-91',
   (CURRENT_DATE - 89)::timestamptz + interval '12 hours', -571.00, 'STALE 91 CO', NULL, 'posted', false, false, false, false);

SELECT * FROM auto_link_pending_outflows_internal('00000000-0000-0000-0000-000000070000'::uuid);

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070090","role":"authenticated"}', true);

SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070501'::uuid)->>'status'),
  'stale_30', 'stale recompute: 31 days old becomes stale_30');
SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070511'::uuid)->>'status'),
  'stale_60', 'stale recompute: 61 days old becomes stale_60');
SELECT is(
  (unlink_pending_outflow('00000000-0000-0000-0000-000000070521'::uuid)->>'status'),
  'stale_90', 'stale recompute: 91 days old becomes stale_90');

-- Scenario F: linked_bank_transaction_id points at a row in another
-- restaurant. This should never happen through normal writes (every write
-- path scopes both rows to the same restaurant_id), but the RPC still
-- filters the bank_transactions lookup by restaurant_id as defense in
-- depth. Confirm the guard actually rejects a cross-restaurant row instead
-- of trusting the outflow's stored id alone.
SET LOCAL role TO postgres;
INSERT INTO restaurants (id, name, timezone) VALUES
  ('00000000-0000-0000-0000-000000070600'::uuid, 'Unlink Other Restaurant', 'America/Chicago')
ON CONFLICT (id) DO UPDATE SET timezone = 'America/Chicago';

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000070610'::uuid, '00000000-0000-0000-0000-000000070600'::uuid, 'fa_test_unlink_other_001', 'Other Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions (id, restaurant_id, connected_bank_id, stripe_transaction_id, transaction_date, amount, description, merchant_name, status, is_categorized, is_transfer, is_split, is_reconciled) VALUES
  ('00000000-0000-0000-0000-000000070602'::uuid, '00000000-0000-0000-0000-000000070600'::uuid,
   '00000000-0000-0000-0000-000000070610'::uuid, 'txn-unlink-other-restaurant',
   now(), -601.00, 'OTHER RESTAURANT CO', NULL, 'posted', false, false, false, false);

INSERT INTO pending_outflows (id, restaurant_id, vendor_name, category_id, payment_method, amount, issue_date, status, linked_bank_transaction_id, cleared_at, auto_linked_at) VALUES
  ('00000000-0000-0000-0000-000000070601'::uuid, '00000000-0000-0000-0000-000000070000'::uuid,
   'Cross Restaurant Co', '00000000-0000-0000-0000-000000070002'::uuid, 'ach', 601.00, CURRENT_DATE - 1, 'cleared',
   '00000000-0000-0000-0000-000000070602'::uuid, now(), now());

SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000070090","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT unlink_pending_outflow('00000000-0000-0000-0000-000000070601'::uuid)$$,
  'Linked bank transaction not found',
  'cross-restaurant guard: bank_transactions lookup ignores a row from another restaurant');

-- Grants -------------------------------------------------------------------------
SET LOCAL role TO postgres;
SELECT ok(
  NOT has_function_privilege('anon', 'public.unlink_pending_outflow(uuid)', 'EXECUTE'),
  'anon cannot execute unlink_pending_outflow (PUBLIC revoked)');
SELECT ok(
  has_function_privilege('authenticated', 'public.unlink_pending_outflow(uuid)', 'EXECUTE'),
  'authenticated can execute unlink_pending_outflow');

SELECT * FROM finish();
ROLLBACK;
