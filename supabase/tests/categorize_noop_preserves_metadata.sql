-- File: supabase/tests/categorize_noop_preserves_metadata.sql
-- Description: Pins the fix for a bug where re-calling categorize_bank_transaction
-- with the SAME category (a no-op reclassification) silently dropped payee/
-- supplier/notes edits because the short-circuit branch returned before the
-- metadata UPDATE. See docs/superpowers/specs/2026-07-09-categorize-noop-metadata-design.md.

BEGIN;
SELECT plan(10);

SET LOCAL role TO postgres;
SET LOCAL "request.jwt.claims" TO '{"sub": "00000000-0000-0000-0000-000000000301"}';

-- Fixture: user, restaurant, membership
INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-000000000301'::uuid, 'noop-metadata-test@example.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000399'::uuid, 'Noop Metadata Test Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_restaurants (user_id, restaurant_id, role) VALUES
  ('00000000-0000-0000-0000-000000000301'::uuid, '00000000-0000-0000-0000-000000000399'::uuid, 'owner')
ON CONFLICT (user_id, restaurant_id) DO UPDATE SET role = 'owner';

-- Chart of accounts:
--   1000 = Cash (required by categorize_bank_transaction as the offsetting account)
--   6000 = Supplies Expense (the category under test)
INSERT INTO chart_of_accounts (id, restaurant_id, account_code, account_name, account_type, account_subtype, normal_balance) VALUES
  ('00000000-0000-0000-0000-000000000350'::uuid, '00000000-0000-0000-0000-000000000399'::uuid, '1000', 'Cash', 'asset', 'cash', 'debit'),
  ('00000000-0000-0000-0000-000000000352'::uuid, '00000000-0000-0000-0000-000000000399'::uuid, '6000', 'Supplies Expense', 'expense', 'operating_expenses', 'debit')
ON CONFLICT (id) DO UPDATE SET account_name = EXCLUDED.account_name;

-- Supplier fixture
INSERT INTO suppliers (id, restaurant_id, name, is_active) VALUES
  ('00000000-0000-0000-0000-000000000360'::uuid, '00000000-0000-0000-0000-000000000399'::uuid, 'Cold Stone Creamery', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Cross-tenant fixture: a DIFFERENT restaurant with its OWN supplier. The test
-- user (301) is NOT a member of this restaurant. Used to prove the short-circuit
-- branch's tenant guard rejects a supplier UUID that belongs to another tenant.
INSERT INTO restaurants (id, name) VALUES
  ('00000000-0000-0000-0000-000000000499'::uuid, 'Other Tenant Restaurant')
ON CONFLICT (id) DO NOTHING;

INSERT INTO suppliers (id, restaurant_id, name, is_active) VALUES
  ('00000000-0000-0000-0000-000000000460'::uuid, '00000000-0000-0000-0000-000000000499'::uuid, 'Foreign Tenant Supplier', true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Connected bank + bank transaction fixture (starts uncategorized)
INSERT INTO connected_banks (id, restaurant_id, stripe_financial_account_id, institution_name, status) VALUES
  ('00000000-0000-0000-0000-000000000361'::uuid, '00000000-0000-0000-0000-000000000399'::uuid, 'fa_test_noop_001', 'Test Bank', 'connected')
ON CONFLICT (id) DO NOTHING;

INSERT INTO bank_transactions (
  id, restaurant_id, connected_bank_id, stripe_transaction_id,
  transaction_date, amount, description, status, is_categorized, is_transfer
) VALUES (
  '00000000-0000-0000-0000-000000000371'::uuid,
  '00000000-0000-0000-0000-000000000399'::uuid,
  '00000000-0000-0000-0000-000000000361'::uuid,
  'txn-noop-metadata-test-1',
  CURRENT_DATE, -42.50, 'POS processing fee', 'posted', false, false
)
ON CONFLICT (id) DO UPDATE SET
  is_categorized = false,
  is_transfer = false,
  category_id = NULL,
  notes = NULL,
  normalized_payee = NULL,
  supplier_id = NULL;

-- STEP 1: Initial categorization to category A ("Supplies Expense"), with a note.
-- This creates the bank_transaction's journal entry (reference_type = 'bank_transaction').
SELECT lives_ok(
  $$ SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000371'::uuid,
       '00000000-0000-0000-0000-000000000352'::uuid,
       'Original note', NULL, NULL
     ) $$,
  'Initial categorization to Supplies Expense succeeds'
);

-- Capture journal-entry count for this transaction after initial categorization.
-- (One row expected: the bank_transaction entry created above.)
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction'
       AND reference_id = '00000000-0000-0000-0000-000000000371'::uuid),
  1,
  'Initial categorization creates exactly one journal entry'
);

-- STEP 2: Re-call categorize_bank_transaction with the SAME category (no-op),
-- plus a supplier_id and normalized_payee. p_description is NULL (mirrors
-- Transactions.tsx / a metadata-only save that should not clobber notes).
SELECT lives_ok(
  $$ SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000371'::uuid,
       '00000000-0000-0000-0000-000000000352'::uuid,
       NULL,
       'Cold Stone Creamery',
       '00000000-0000-0000-0000-000000000360'::uuid
     ) $$,
  'No-op-category re-categorize call (with supplier/payee) succeeds'
);

-- TEST: supplier_id is now persisted
SELECT is(
  (SELECT supplier_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000371'::uuid),
  '00000000-0000-0000-0000-000000000360'::uuid,
  'supplier_id is persisted by the no-op-category call'
);

-- TEST: normalized_payee is now persisted
SELECT is(
  (SELECT normalized_payee FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000371'::uuid),
  'Cold Stone Creamery',
  'normalized_payee is persisted by the no-op-category call'
);

-- TEST: notes preserved (p_description was NULL on the no-op call; must not wipe the original note)
SELECT is(
  (SELECT notes FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000371'::uuid),
  'Original note',
  'notes preserved (not wiped) when p_description is NULL on a no-op-category call'
);

-- TEST: no extra journal entry created for the no-op call (short-circuit still skips the ledger)
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
     WHERE reference_type = 'bank_transaction'
       AND reference_id = '00000000-0000-0000-0000-000000000371'::uuid),
  1,
  'No extra journal entry created by the no-op-category call'
);

-- TEST: the no-op call's return value reports success with no reclassification / journal entry
SELECT is(
  (SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000371'::uuid,
       '00000000-0000-0000-0000-000000000352'::uuid,
       NULL, 'Cold Stone Creamery', '00000000-0000-0000-0000-000000000360'::uuid
     ) - 'transaction_id'),
  '{"success": true, "journal_entry_id": null, "is_reclassification": false}'::jsonb,
  'No-op-category call returns success=true, is_reclassification=false, journal_entry_id=NULL'
);

-- STEP 3 (cross-tenant guard, added for the Phase 7b codex finding):
-- Re-call the no-op-category path passing a supplier UUID that belongs to
-- ANOTHER restaurant (id ...460, restaurant ...499). The SECURITY DEFINER
-- function must NOT cross-link it. supplier_id was ...360 from STEP 2, so it
-- must stay ...360 (foreign supplier silently ignored, existing preserved).
SELECT lives_ok(
  $$ SELECT categorize_bank_transaction(
       '00000000-0000-0000-0000-000000000371'::uuid,
       '00000000-0000-0000-0000-000000000352'::uuid,
       NULL, NULL,
       '00000000-0000-0000-0000-000000000460'::uuid
     ) $$,
  'No-op call passing a foreign-tenant supplier_id succeeds (does not raise)'
);

SELECT is(
  (SELECT supplier_id FROM bank_transactions WHERE id = '00000000-0000-0000-0000-000000000371'::uuid),
  '00000000-0000-0000-0000-000000000360'::uuid,
  'foreign-tenant supplier_id is rejected; existing (own-tenant) supplier_id is preserved'
);

SELECT * FROM finish();
ROLLBACK;
