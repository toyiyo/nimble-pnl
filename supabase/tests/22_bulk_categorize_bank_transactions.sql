-- File: supabase/tests/22_bulk_categorize_bank_transactions.sql
-- Description: RED-phase pgTAP tests for the new bulk_categorize_bank_transactions
-- RPC. The RPC does not exist yet (it lands in the next task); every test
-- below must fail against the current schema. See
-- docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md
-- section 5 for the guard order and per-row branch semantics this pins.

BEGIN;
SELECT plan(38);

SET LOCAL role TO postgres;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

-- Test user: member of R_MAIN and R_NOCASH, NOT a member of R_OTHER.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000601'::uuid, 'bulk-categorize-test@example.com')
ON CONFLICT (id) DO NOTHING;

-- R_MAIN: the primary restaurant, fully provisioned (cash account, one
-- active category, one inactive category).
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000610'::uuid, 'Bulk Categorize Main Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000601'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000000611'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit', true),
  ('00000000-0000-0000-0000-000000000612'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000000613'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '6010', 'Repairs Expense', 'expense', 'operating_expenses', 'debit', true),
  ('00000000-0000-0000-0000-000000000614'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '6099', 'Old Category', 'expense', 'operating_expenses', 'debit', false)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = EXCLUDED.is_active;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000615'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, 'fa_test_bulk_main_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

-- Guard-test users, both members of R_MAIN: a staff user (no
-- edit:transactions capability) and a collaborator_accountant user (has
-- edit:transactions capability). See tests 22-24.
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000602'::uuid, 'bulk-categorize-staff@example.com'),
  ('00000000-0000-0000-0000-000000000603'::uuid, 'bulk-categorize-accountant@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000602'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, 'staff'),
  ('00000000-0000-0000-0000-000000000603'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, 'collaborator_accountant')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = EXCLUDED.role;

-- Row for the capability-guard tests (22-24). The date sits outside the
-- closed fiscal period fixture (2020-01-01 to 2020-01-31) below, so the
-- RPC does not skip it with reason 'closed_period'.
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES (
  '00000000-0000-0000-0000-000000000715'::uuid,
  '00000000-0000-0000-0000-000000000610'::uuid,
  '00000000-0000-0000-0000-000000000615'::uuid,
  'txn-bulk-capability-guard-1',
  DATE '2026-08-01', -12.00, 'Capability guard test row', 'posted', false, false, false
)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = false, is_transfer = false, is_reconciled = false, category_id = NULL;

-- R_NOCASH: user is a member, has an active category, but NO account_code
-- '1000'. Used only by the "cash account missing" guard test.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000620'::uuid, 'Bulk Categorize No-Cash Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000601'::uuid, '00000000-0000-0000-0000-000000000620'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance, is_active) VALUES
  ('00000000-0000-0000-0000-000000000621'::uuid, '00000000-0000-0000-0000-000000000620'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit', true)
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name, is_active = EXCLUDED.is_active;

-- R_OTHER: the test user has NO membership here. Used for the "no
-- membership" guard test and as the source of a cross-tenant transaction id.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000630'::uuid, 'Bulk Categorize Other Tenant Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000631'::uuid, '00000000-0000-0000-0000-000000000630'::uuid, 'fa_test_bulk_other_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES (
  '00000000-0000-0000-0000-000000000732'::uuid,
  '00000000-0000-0000-0000-000000000630'::uuid,
  '00000000-0000-0000-0000-000000000631'::uuid,
  'txn-bulk-foreign-tenant-1',
  CURRENT_DATE, -15.00, 'Foreign tenant transaction', 'posted', false, false, false
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL;

-- R_MAIN bank_transactions, one per test case.
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled, suggested_category_id, category_id
) VALUES
  -- Test 6: negative amount -> debit category, credit cash.
  ('00000000-0000-0000-0000-000000000701'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-neg-amount-1', CURRENT_DATE, -42.50, 'Negative amount txn', 'posted', false, false, false, NULL, NULL),
  -- Test 7: positive amount -> debit cash, credit category.
  ('00000000-0000-0000-0000-000000000702'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-pos-amount-1', CURRENT_DATE, 100.00, 'Positive amount txn', 'posted', false, false, false, NULL, NULL),
  -- Test 8: suggested_category_id must be cleared to NULL after the call.
  ('00000000-0000-0000-0000-000000000703'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-suggested-1', CURRENT_DATE, -10.00, 'Has AI suggestion', 'posted', false, false, false,
   '00000000-0000-0000-0000-000000000612'::uuid, NULL),
  -- Test 9: already categorized with the ACTIVE category; re-run with the SAME category.
  ('00000000-0000-0000-0000-000000000704'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-same-cat-1', CURRENT_DATE, -20.00, 'Already categorized, same category', 'posted', true, false, false,
   NULL, '00000000-0000-0000-0000-000000000612'::uuid),
  -- Test 10: already categorized with the ACTIVE category; reclassify to a DIFFERENT category.
  ('00000000-0000-0000-0000-000000000705'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-reclass-1', CURRENT_DATE, -30.00, 'Already categorized, reclassify', 'posted', true, false, false,
   NULL, '00000000-0000-0000-0000-000000000612'::uuid),
  -- Test 11: reconciled AND uncategorized -> must skip (reason 'reconciled').
  ('00000000-0000-0000-0000-000000000706'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-reconciled-uncat-1', CURRENT_DATE, -25.00, 'Reconciled, uncategorized', 'posted', false, false, true,
   NULL, NULL),
  -- Test 12: reconciled AND already categorized -> reclassification must succeed.
  ('00000000-0000-0000-0000-000000000707'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-reconciled-cat-1', CURRENT_DATE, -35.00, 'Reconciled, categorized', 'posted', true, false, true,
   NULL, '00000000-0000-0000-0000-000000000612'::uuid),
  -- Test 13: date inside a closed fiscal period -> must skip (reason 'closed_period').
  ('00000000-0000-0000-0000-000000000708'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-closed-period-1', DATE '2020-01-15', -50.00, 'In a closed fiscal period', 'posted', false, false, false,
   NULL, NULL),
  -- Test 14: valid R_MAIN transaction paired with the cross-tenant id (...732) in one call.
  ('00000000-0000-0000-0000-000000000709'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-crosstenant-valid-1', CURRENT_DATE, -60.00, 'Valid row alongside a foreign id', 'posted', false, false, false,
   NULL, NULL),
  -- Test 15/16: result shape and entry_date.
  ('00000000-0000-0000-0000-000000000710'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-shape-1', DATE '2026-03-10', -75.00, 'Shape and entry_date txn', 'posted', false, false, false,
   NULL, NULL)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = EXCLUDED.is_categorized,
  is_reconciled = EXCLUDED.is_reconciled,
  category_id = EXCLUDED.category_id,
  suggested_category_id = EXCLUDED.suggested_category_id;

-- R_MAIN bank_transactions covering the transfer / excluded / split skip
-- guards. Unlike the single-row categorize flow, the page that drives this
-- RPC (src/pages/Transactions.tsx) loads every status in one list, so a
-- bulk selection can include a transfer, an Excluded-tab row, or a split
-- parent (codex review finding on this PR).
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer,
  is_reconciled, category_id, excluded_reason, is_split
) VALUES
  -- Test 18: is_transfer = true -> must skip, reason 'excluded'.
  ('00000000-0000-0000-0000-000000000712'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-transfer-1', CURRENT_DATE, -15.00, 'Transfer between accounts', 'posted', false, true, false, NULL, NULL, false),
  -- Test 19: excluded_reason set -> must skip, reason 'excluded'.
  ('00000000-0000-0000-0000-000000000713'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-excluded-1', CURRENT_DATE, -18.00, 'Marked excluded', 'posted', false, false, false, NULL, 'duplicate', false),
  -- Test 20/21: split parent (is_categorized = true, category_id NULL,
  -- is_split = true) -> must skip, reason 'split', and must not gain a
  -- journal entry.
  ('00000000-0000-0000-0000-000000000714'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
   'txn-bulk-split-parent-1', CURRENT_DATE, -90.00, 'Split parent', 'posted', true, false, false, NULL, NULL, true)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = EXCLUDED.is_categorized,
  is_transfer = EXCLUDED.is_transfer,
  category_id = EXCLUDED.category_id,
  excluded_reason = EXCLUDED.excluded_reason,
  is_split = EXCLUDED.is_split;

-- Closed fiscal period covering the 2020-01-15 transaction above.
INSERT INTO fiscal_periods (id, restaurant_id, period_start, period_end, is_closed, closed_at) VALUES
  ('00000000-0000-0000-0000-000000000640'::uuid, '00000000-0000-0000-0000-000000000610'::uuid,
   DATE '2020-01-01', DATE '2020-01-31', true, now())
ON CONFLICT (id) DO UPDATE SET is_closed = true;

-- Impersonate the test user for every RPC call below.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Test 1: no membership -> Unauthorized
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000732'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000630'::uuid
     ) $$,
  '%Unauthorized%',
  'No membership on p_restaurant_id raises Unauthorized'
);

-- ---------------------------------------------------------------------------
-- Test 2: inactive category -> Category not found or inactive
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000701'::uuid],
       '00000000-0000-0000-0000-000000000614'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  '%Category not found or inactive%',
  'Inactive category raises Category not found or inactive'
);

-- ---------------------------------------------------------------------------
-- Test 3: no cash account 1000 -> Cash account (1000) not found
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000732'::uuid],
       '00000000-0000-0000-0000-000000000621'::uuid,
       '00000000-0000-0000-0000-000000000620'::uuid
     ) $$,
  '%Cash account (1000) not found%',
  'Missing cash account 1000 raises Cash account (1000) not found'
);

-- ---------------------------------------------------------------------------
-- Test 4: empty array -> raises
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY[]::uuid[],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  '%p_transaction_ids must not be empty%',
  'Empty p_transaction_ids raises'
);

-- ---------------------------------------------------------------------------
-- Test 5: array over 500 ids -> raises
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 501)),
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  '%p_transaction_ids must contain 500 ids or fewer%',
  'p_transaction_ids over 500 ids raises'
);

-- ---------------------------------------------------------------------------
-- Test 6: negative amount -> debit category, credit cash, both ABS()
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000701'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  'Negative-amount categorize call succeeds'
);

SELECT is(
  (SELECT jel.debit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000701'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000612'::uuid),
  42.50,
  'Negative amount: category line is debited ABS(amount)'
);

SELECT is(
  (SELECT jel.credit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000701'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000611'::uuid),
  42.50,
  'Negative amount: cash line is credited ABS(amount)'
);

-- ---------------------------------------------------------------------------
-- Test 7: positive amount -> debit cash, credit category
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000702'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  'Positive-amount categorize call succeeds'
);

SELECT is(
  (SELECT jel.debit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000702'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000611'::uuid),
  100.00,
  'Positive amount: cash line is debited'
);

SELECT is(
  (SELECT jel.credit_amount FROM journal_entry_lines jel
     JOIN journal_entries je ON je.id = jel.journal_entry_id
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000702'::uuid
       AND jel.account_id = '00000000-0000-0000-0000-000000000612'::uuid),
  100.00,
  'Positive amount: category line is credited'
);

-- ---------------------------------------------------------------------------
-- Test 8: suggested_category_id is cleared to NULL after the call
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000703'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  'Categorize call on a row with an AI suggestion succeeds'
);

SELECT is(
  (SELECT suggested_category_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000703'::uuid),
  NULL::uuid,
  'suggested_category_id is cleared to NULL by the bulk call'
);

-- ---------------------------------------------------------------------------
-- Test 9: same category again -> unchanged_count = 1, no new entry
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000704'::uuid),
  0,
  'Same-category fixture starts with no journal entry (categorized directly, not via RPC)'
);

SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000704'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) ->> 'unchanged_count')::int,
  1,
  'Re-categorizing to the same category reports unchanged_count = 1'
);

SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000704'::uuid),
  0,
  'Same-category call creates no journal entry'
);

-- ---------------------------------------------------------------------------
-- Test 10: different category on a categorized row -> RECLASS- entry +
-- transaction_reclassifications row, reclassified_count = 1
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000705'::uuid],
       '00000000-0000-0000-0000-000000000613'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) ->> 'reclassified_count')::int,
  1,
  'Reclassifying to a different category reports reclassified_count = 1'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM journal_entries
    WHERE reference_type = 'reclassification'
      AND entry_number LIKE 'RECLASS-%'
      AND restaurant_id = '00000000-0000-0000-0000-000000000610'::uuid
      AND description LIKE '%' || (SELECT description FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000705'::uuid) || '%'
  ),
  'Reclassification creates a RECLASS- journal entry'
);

SELECT is(
  (SELECT COUNT(*)::int FROM transaction_reclassifications
     WHERE bank_transaction_id = '00000000-0000-0000-0000-000000000705'::uuid
       AND original_category_id = '00000000-0000-0000-0000-000000000612'::uuid
       AND new_category_id = '00000000-0000-0000-0000-000000000613'::uuid),
  1,
  'Reclassification writes a transaction_reclassifications row'
);

-- ---------------------------------------------------------------------------
-- Test 11: reconciled + uncategorized -> skipped, reason 'reconciled'
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT jsonb_array_length(
     bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000706'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) -> 'skipped'
  )),
  1,
  'Reconciled + uncategorized row lands in skipped'
);

SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000706'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000706'::uuid),
  'reconciled',
  'Reconciled + uncategorized skip reason is reconciled'
);

-- ---------------------------------------------------------------------------
-- Test 12: reconciled + categorized -> reclassification succeeds
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000707'::uuid],
       '00000000-0000-0000-0000-000000000613'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) ->> 'reclassified_count')::int,
  1,
  'Reconciled + already-categorized row reclassifies successfully'
);

-- ---------------------------------------------------------------------------
-- Test 13: date inside a closed fiscal period -> skipped, reason 'closed_period'
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000708'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000708'::uuid),
  'closed_period',
  'Row in a closed fiscal period skips with reason closed_period'
);

-- ---------------------------------------------------------------------------
-- Test 14: cross-tenant id in the array -> reason 'not_found'; other rows succeed
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000709'::uuid, '00000000-0000-0000-0000-000000000732'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) ->> 'categorized_count')::int,
  1,
  'The in-tenant row categorizes even when a cross-tenant id shares the call'
);

SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000709'::uuid, '00000000-0000-0000-0000-000000000732'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000732'::uuid),
  'not_found',
  'The cross-tenant id lands in skipped with reason not_found'
);

-- ---------------------------------------------------------------------------
-- Test 15: result shape
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000710'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     )) ?& ARRAY['success', 'categorized_count', 'reclassified_count', 'unchanged_count', 'skipped'],
  'Result jsonb has keys success, categorized_count, reclassified_count, unchanged_count, skipped'
);

-- ---------------------------------------------------------------------------
-- Test 16: entry_date equals the UTC calendar day of transaction_date
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT je.entry_date FROM journal_entries je
     WHERE je.reference_type = 'bank_transaction' AND je.reference_id = '00000000-0000-0000-0000-000000000710'::uuid),
  DATE '2026-03-10',
  'entry_date equals the UTC calendar day of transaction_date'
);

-- ---------------------------------------------------------------------------
-- Test 17: p_skip_rebuild = true still creates the journal entry but
-- leaves current_balance untouched; a direct rebuild_account_balances call
-- afterward picks up the change. Covers the fix for the multi-chunk
-- rebuild-amplification finding (performance review).
-- ---------------------------------------------------------------------------
INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES (
  '00000000-0000-0000-0000-000000000711'::uuid, '00000000-0000-0000-0000-000000000610'::uuid, '00000000-0000-0000-0000-000000000615'::uuid,
  'txn-bulk-skip-rebuild-1', CURRENT_DATE, -80.00, 'Skip-rebuild flag txn', 'posted', false, false, false
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL, is_reconciled = false;

SELECT set_config(
  'bulk_categorize_test.balance_before',
  (SELECT current_balance::text FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000000612'::uuid),
  true
);

SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000711'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid,
       true
     ) ->> 'categorized_count')::int,
  1,
  'p_skip_rebuild = true still creates the journal entry'
);

SELECT is(
  (SELECT current_balance::text FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000000612'::uuid),
  current_setting('bulk_categorize_test.balance_before'),
  'p_skip_rebuild = true leaves current_balance unchanged (no internal rebuild)'
);

SELECT rebuild_account_balances('00000000-0000-0000-0000-000000000610'::uuid);

SELECT isnt(
  (SELECT current_balance::text FROM chart_of_accounts WHERE id = '00000000-0000-0000-0000-000000000612'::uuid),
  current_setting('bulk_categorize_test.balance_before'),
  'A direct rebuild_account_balances call after p_skip_rebuild = true reflects the new entry'
);

-- ---------------------------------------------------------------------------
-- Test 18: is_transfer = true -> skipped, reason 'excluded'
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000712'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000712'::uuid),
  'excluded',
  'Transfer row skips with reason excluded'
);

-- ---------------------------------------------------------------------------
-- Test 19: excluded_reason set -> skipped, reason 'excluded'
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000713'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000713'::uuid),
  'excluded',
  'Row marked excluded skips with reason excluded'
);

-- ---------------------------------------------------------------------------
-- Test 20/21: split parent -> skipped, reason 'split', no journal entry
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT (skip ->> 'reason')
     FROM jsonb_array_elements(
       bulk_categorize_bank_transactions(
         ARRAY['00000000-0000-0000-0000-000000000714'::uuid],
         '00000000-0000-0000-0000-000000000612'::uuid,
         '00000000-0000-0000-0000-000000000610'::uuid
       ) -> 'skipped'
     ) AS skip
     WHERE (skip ->> 'id')::uuid = '00000000-0000-0000-0000-000000000714'::uuid),
  'split',
  'Split parent skips with reason split'
);

SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction' AND reference_id = '00000000-0000-0000-0000-000000000714'::uuid),
  0,
  'Split parent gains no journal entry from the bulk call'
);

-- ---------------------------------------------------------------------------
-- Test 22: staff role lacks edit:transactions -> Access denied
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000602","role":"authenticated"}', true);

SELECT throws_like(
  $$ SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000715'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) $$,
  '%Access denied%',
  'Staff role without edit:transactions raises Access denied'
);

-- ---------------------------------------------------------------------------
-- Test 23: the denied staff call above wrote nothing
-- ---------------------------------------------------------------------------
SET LOCAL role TO postgres;

SELECT ok(
  (SELECT is_categorized = false FROM bank_transactions
     WHERE id = '00000000-0000-0000-0000-000000000715'::uuid
       AND restaurant_id = '00000000-0000-0000-0000-000000000610'::uuid)
  AND NOT EXISTS (
    SELECT 1 FROM journal_entries
     WHERE reference_type = 'bank_transaction'
       AND reference_id = '00000000-0000-0000-0000-000000000715'::uuid
       AND restaurant_id = '00000000-0000-0000-0000-000000000610'::uuid
  ),
  'Row stays uncategorized and gains no journal entry after the denied staff call'
);

-- ---------------------------------------------------------------------------
-- Test 24: collaborator_accountant has edit:transactions -> call succeeds
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000603","role":"authenticated"}', true);

SELECT is(
  (SELECT bulk_categorize_bank_transactions(
       ARRAY['00000000-0000-0000-0000-000000000715'::uuid],
       '00000000-0000-0000-0000-000000000612'::uuid,
       '00000000-0000-0000-0000-000000000610'::uuid
     ) ->> 'categorized_count')::int,
  1,
  'collaborator_accountant with edit:transactions categorizes the row'
);

-- Restore impersonation to the primary test user in case a later test is
-- added after this block.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000601","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- Test 25: local entry day: an evening instant lands on the restaurant-local day.
-- 03:30Z on 2026-02-02 = 21:30 CST on 2026-02-01 (America/Chicago).
-- Pin the timezone the assertion depends on. Do not rely on the column
-- default.
-- ---------------------------------------------------------------------------
UPDATE restaurants SET timezone = 'America/Chicago'
  WHERE id = '00000000-0000-0000-0000-000000000610'::uuid;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer, is_reconciled
) VALUES (
  '00000000-0000-0000-0000-000000000760'::uuid,
  '00000000-0000-0000-0000-000000000610'::uuid,
  '00000000-0000-0000-0000-000000000615'::uuid,
  'txn-bulk-evening-instant-1',
  TIMESTAMPTZ '2026-02-02 03:30:00+00', -33.00, 'Evening instant', 'posted', false, false, false
)
ON CONFLICT (id) DO UPDATE SET is_categorized = false, category_id = NULL;

SELECT bulk_categorize_bank_transactions(
  p_restaurant_id   => '00000000-0000-0000-0000-000000000610'::uuid,
  p_category_id     => '00000000-0000-0000-0000-000000000612'::uuid,
  p_transaction_ids => ARRAY['00000000-0000-0000-0000-000000000760'::uuid],
  p_skip_rebuild    => true
);

SELECT is(
  (SELECT entry_date FROM journal_entries
   WHERE reference_type = 'bank_transaction'
     AND reference_id = '00000000-0000-0000-0000-000000000760'::uuid),
  DATE '2026-02-01',
  'bulk categorize writes the restaurant-local entry day');

SELECT * FROM finish();
ROLLBACK;
