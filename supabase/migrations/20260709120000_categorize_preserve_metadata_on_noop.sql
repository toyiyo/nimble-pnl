-- Fix: preserve payee/supplier/notes edits on a no-op-category categorize call
--
-- Bug: categorize_bank_transaction's short-circuit for a no-op category change
-- (same category re-selected) returned early BEFORE the UPDATE that persists
-- normalized_payee / supplier_id / notes. A metadata-only edit on an already-
-- categorized transaction (e.g. setting a Payee/Supplier while keeping the
-- same category) reported success but silently dropped the write.
--
-- Fix: add a metadata-preserving UPDATE inside the short-circuit branch,
-- before its RETURN. The journal-entry skip in that branch is intentional
-- and unchanged (no ledger movement for a no-op category).
--
-- See docs/superpowers/specs/2026-07-09-categorize-noop-metadata-design.md
-- for full root-cause analysis and rationale.
--
-- This migration is a CREATE OR REPLACE of the function body from
-- supabase/migrations/20251021204739_73ec6be4-bfd6-4f6a-98cc-574c76967421.sql,
-- adding: (1) the metadata-preserving UPDATE inside the short-circuit IF, and
-- (2) a hoisted tenant-scope guard on p_supplier_id (after the membership auth
-- check) that covers BOTH the no-op short-circuit and the pre-existing main
-- categorize/reclassify UPDATE — closing the cross-tenant supplier-link gap the
-- SECURITY DEFINER function had on the plain suppliers(id) FK (codex + CodeRabbit
-- review finding).

CREATE OR REPLACE FUNCTION public.categorize_bank_transaction(
  p_transaction_id uuid,
  p_category_id uuid,
  p_description text DEFAULT NULL,
  p_normalized_payee text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_transaction RECORD;
  v_category RECORD;
  v_is_reclassification boolean := false;
  v_original_category_id uuid;
  v_journal_entry_id uuid;
  v_cash_account RECORD;
  v_fiscal_period RECORD;
  v_existing_journal_entry uuid;
  v_reclass_reference_id uuid;
BEGIN
  -- Get transaction details
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Verify user has access to this restaurant
  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE restaurant_id = v_transaction.restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Tenant-scope p_supplier_id before ANY write path uses it. This function is
  -- SECURITY DEFINER (bypasses RLS) and bank_transactions.supplier_id only has a
  -- plain FK to suppliers(id), so an unscoped write would let a user with access
  -- to this restaurant link the transaction to another tenant's supplier by UUID.
  -- If the supplier isn't visible to this restaurant, silently drop it (fall back
  -- to preserving the existing supplier_id via COALESCE downstream) rather than
  -- raising. Hoisted here so BOTH the no-op short-circuit and the main
  -- categorize/reclassify UPDATE below are covered by a single guard.
  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM suppliers
    WHERE id = p_supplier_id
      AND restaurant_id = v_transaction.restaurant_id
  ) THEN
    p_supplier_id := NULL;
  END IF;

  -- Check if this is a reclassification
  IF v_transaction.is_categorized AND v_transaction.category_id IS NOT NULL THEN
    v_is_reclassification := true;
    v_original_category_id := v_transaction.category_id;
  END IF;

  -- Short-circuit when category doesn't actually change (avoid no-op reclassifications)
  IF v_is_reclassification AND v_original_category_id = p_category_id THEN
    -- Category unchanged: no journal entry needed (skipping rebuild_account_balances
    -- is correct — no ledger movement), but still persist metadata edits
    -- (payee / supplier / notes) so a UI "Save" is not a silent no-op.
    -- p_supplier_id was already tenant-scoped above (hoisted guard).
    UPDATE bank_transactions
    SET
      normalized_payee = COALESCE(p_normalized_payee, normalized_payee),
      supplier_id      = COALESCE(p_supplier_id, supplier_id),
      -- COALESCE (preserve-on-null), NOT the main path's unconditional
      -- `notes = p_description`: Transactions.tsx calls this RPC with
      -- p_description = NULL, so an unconditional write here would wipe a user's
      -- note on a same-category call. Intentional asymmetry — do not "fix".
      notes            = COALESCE(p_description, notes),
      updated_at       = now()
    WHERE id = p_transaction_id;

    RETURN jsonb_build_object(
      'success', true,
      'journal_entry_id', NULL,
      'is_reclassification', false,
      'transaction_id', p_transaction_id
    );
  END IF;

  -- Block initial categorization of reconciled transactions
  IF v_transaction.is_reconciled AND NOT v_is_reclassification THEN
    RAISE EXCEPTION 'Cannot categorize a reconciled transaction. Use reclassification instead by updating the category of an already categorized transaction.';
  END IF;

  -- Get category details
  SELECT * INTO v_category
  FROM chart_of_accounts
  WHERE id = p_category_id
    AND restaurant_id = v_transaction.restaurant_id
    AND is_active = true;

  IF v_category.id IS NULL THEN
    RAISE EXCEPTION 'Category not found or inactive';
  END IF;

  -- Check if transaction falls in a closed fiscal period
  SELECT * INTO v_fiscal_period
  FROM fiscal_periods
  WHERE restaurant_id = v_transaction.restaurant_id
    AND v_transaction.transaction_date >= period_start
    AND v_transaction.transaction_date <= period_end
    AND is_closed = true
  LIMIT 1;

  IF v_fiscal_period.id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot categorize transaction in closed fiscal period. Period closed on %', v_fiscal_period.closed_at;
  END IF;

  -- Get cash account
  SELECT * INTO v_cash_account
  FROM chart_of_accounts
  WHERE restaurant_id = v_transaction.restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account.id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found';
  END IF;

  -- Check if a journal entry already exists
  SELECT id INTO v_existing_journal_entry
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
    AND reference_id = v_transaction.id
    AND restaurant_id = v_transaction.restaurant_id
  LIMIT 1;

  -- Handle reclassification
  IF v_is_reclassification THEN
    -- Generate a unique reference_id for this reclassification
    v_reclass_reference_id := gen_random_uuid();

    INSERT INTO journal_entries (
      restaurant_id, entry_date, entry_number, description,
      reference_type, reference_id, total_debit, total_credit, created_by
    ) VALUES (
      v_transaction.restaurant_id, v_transaction.transaction_date,
      'RECLASS-' || v_transaction.id::text || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
      COALESCE(p_description, 'Reclassification: ' || v_transaction.description),
      'reclassification', v_reclass_reference_id,  -- Use unique reference_id
      ABS(v_transaction.amount), ABS(v_transaction.amount), auth.uid()
    ) RETURNING id INTO v_journal_entry_id;

    IF v_transaction.amount < 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, p_category_id, ABS(v_transaction.amount), 0, 'Reclassify to ' || v_category.account_name),
        (v_journal_entry_id, v_original_category_id, 0, ABS(v_transaction.amount), 'Reclassify from previous category');
    ELSE
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, v_original_category_id, ABS(v_transaction.amount), 0, 'Reclassify from previous category'),
        (v_journal_entry_id, p_category_id, 0, ABS(v_transaction.amount), 'Reclassify to ' || v_category.account_name);
    END IF;

    INSERT INTO transaction_reclassifications (
      restaurant_id, bank_transaction_id, original_category_id,
      new_category_id, reclass_journal_entry_id, reason, created_by
    ) VALUES (
      v_transaction.restaurant_id, v_transaction.id, v_original_category_id,
      p_category_id, v_journal_entry_id, p_description, auth.uid()
    );
  ELSE
    IF v_existing_journal_entry IS NOT NULL THEN
      v_journal_entry_id := v_existing_journal_entry;
      DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
      UPDATE journal_entries
      SET description = COALESCE(p_description, v_transaction.description),
          total_debit = ABS(v_transaction.amount),
          total_credit = ABS(v_transaction.amount),
          updated_at = now()
      WHERE id = v_existing_journal_entry;
    ELSE
      INSERT INTO journal_entries (
        restaurant_id, entry_date, entry_number, description,
        reference_type, reference_id, total_debit, total_credit, created_by
      ) VALUES (
        v_transaction.restaurant_id, v_transaction.transaction_date,
        'BANK-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
        COALESCE(p_description, v_transaction.description),
        'bank_transaction', v_transaction.id,
        ABS(v_transaction.amount), ABS(v_transaction.amount), auth.uid()
      ) RETURNING id INTO v_journal_entry_id;
    END IF;

    IF v_transaction.amount < 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, p_category_id, ABS(v_transaction.amount), 0, v_category.account_name),
        (v_journal_entry_id, v_cash_account.id, 0, ABS(v_transaction.amount), 'Cash payment');
    ELSE
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, v_cash_account.id, ABS(v_transaction.amount), 0, 'Cash received'),
        (v_journal_entry_id, p_category_id, 0, ABS(v_transaction.amount), v_category.account_name);
    END IF;
  END IF;

  -- Update transaction with notes, payee, and supplier (preserve supplier_id with COALESCE)
  UPDATE bank_transactions
  SET
    category_id = p_category_id,
    is_categorized = true,
    notes = p_description,
    normalized_payee = COALESCE(p_normalized_payee, normalized_payee),
    supplier_id = COALESCE(p_supplier_id, supplier_id),
    updated_at = now()
  WHERE id = p_transaction_id;

  -- Rebuild account balances
  PERFORM rebuild_account_balances(v_transaction.restaurant_id);

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_entry_id,
    'is_reclassification', v_is_reclassification,
    'transaction_id', p_transaction_id
  );
END;
$function$;
