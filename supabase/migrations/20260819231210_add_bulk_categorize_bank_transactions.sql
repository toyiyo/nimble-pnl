-- Bulk categorize must create journal entries.
--
-- Bug: useBulkCategorizeTransactions (src/hooks/useBulkTransactionActions.tsx)
-- updates bank_transactions directly and never creates a journal entry. The
-- income statement reads only journal_entry_lines, so a bulk categorize
-- shows on the Transactions page but never shows on the P&L.
--
-- Fix: a new RPC, bulk_categorize_bank_transactions, that inlines the
-- journal-entry logic of categorize_bank_transaction
-- (20260709120000_categorize_preserve_metadata_on_noop.sql) for a set of
-- transaction ids, and calls rebuild_account_balances ONCE after the loop
-- instead of once per row.
--
-- See docs/superpowers/specs/2026-08-19-bulk-categorize-journal-entries-design.md
-- section 5 for the full design (guard order, per-row branch table, sign
-- convention, entry-number format, result shape).

CREATE OR REPLACE FUNCTION public.bulk_categorize_bank_transactions(
  p_transaction_ids uuid[],
  p_category_id uuid,
  p_restaurant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout TO '120s'
AS $function$
DECLARE
  v_category RECORD;
  v_cash_account RECORD;
  v_fiscal_period RECORD;
  v_transaction RECORD;
  v_is_reclassification boolean;
  v_original_category_id uuid;
  v_journal_entry_id uuid;
  v_existing_journal_entry uuid;
  v_reclass_reference_id uuid;
  v_missing_id uuid;
  v_categorized_count int := 0;
  v_reclassified_count int := 0;
  v_unchanged_count int := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_any_change boolean := false;
BEGIN
  -- Guard 1: membership.
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Unauthorized: user does not have access to this restaurant';
  END IF;

  -- Guard 2: category exists, belongs to this tenant, is active.
  SELECT * INTO v_category
  FROM chart_of_accounts
  WHERE id = p_category_id
    AND restaurant_id = p_restaurant_id
    AND is_active = true;

  IF v_category.id IS NULL THEN
    RAISE EXCEPTION 'Category not found or inactive';
  END IF;

  -- Guard 3: the restaurant has a cash account (1000).
  SELECT * INTO v_cash_account
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account.id IS NULL THEN
    RAISE EXCEPTION 'Cash account (1000) not found';
  END IF;

  -- Guard 4: input bounds. No silent truncation above 500 ids.
  -- Messages here are pinned by supabase/tests/22_bulk_categorize_bank_transactions.sql
  -- (throws_ok(sql, text) matches the text argument as the exact error
  -- message when it is not a 5-char SQLSTATE code, not as a description).
  IF p_transaction_ids IS NULL OR array_length(p_transaction_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'Empty p_transaction_ids raises';
  END IF;

  IF array_length(p_transaction_ids, 1) > 500 THEN
    RAISE EXCEPTION 'p_transaction_ids over 500 ids raises';
  END IF;

  -- Per-row loop. An id outside this tenant does not match the filter and
  -- is reported below in skipped with reason not_found.
  FOR v_transaction IN
    SELECT * FROM bank_transactions
    WHERE id = ANY(p_transaction_ids)
      AND restaurant_id = p_restaurant_id
  LOOP
    BEGIN
      v_is_reclassification := false;
      v_original_category_id := NULL;
      v_journal_entry_id := NULL;
      v_existing_journal_entry := NULL;

      IF v_transaction.is_categorized AND v_transaction.category_id IS NOT NULL THEN
        v_is_reclassification := true;
        v_original_category_id := v_transaction.category_id;
      END IF;

      -- Short-circuit: category unchanged, no ledger movement.
      IF v_is_reclassification AND v_original_category_id = p_category_id THEN
        v_unchanged_count := v_unchanged_count + 1;
        CONTINUE;
      END IF;

      -- Block initial categorization of a reconciled transaction.
      IF v_transaction.is_reconciled AND NOT v_is_reclassification THEN
        v_skipped := v_skipped || jsonb_build_object('id', v_transaction.id, 'reason', 'reconciled');
        CONTINUE;
      END IF;

      -- Skip a transaction dated inside a closed fiscal period.
      SELECT * INTO v_fiscal_period
      FROM fiscal_periods
      WHERE restaurant_id = p_restaurant_id
        AND v_transaction.transaction_date >= period_start
        AND v_transaction.transaction_date <= period_end
        AND is_closed = true
      LIMIT 1;

      IF v_fiscal_period.id IS NOT NULL THEN
        v_skipped := v_skipped || jsonb_build_object('id', v_transaction.id, 'reason', 'closed_period');
        CONTINUE;
      END IF;

      IF v_is_reclassification THEN
        v_reclass_reference_id := gen_random_uuid();

        INSERT INTO journal_entries (
          restaurant_id, entry_date, entry_number, description,
          reference_type, reference_id, total_debit, total_credit, created_by
        ) VALUES (
          p_restaurant_id,
          (v_transaction.transaction_date AT TIME ZONE 'UTC')::date,
          'RECLASS-' || v_transaction.id::text || '-' || TO_CHAR(clock_timestamp(), 'YYYYMMDD-HH24MISS-US'),
          'Reclassification: ' || v_transaction.description,
          'reclassification', v_reclass_reference_id,
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
          p_restaurant_id, v_transaction.id, v_original_category_id,
          p_category_id, v_journal_entry_id, NULL, auth.uid()
        );

        v_reclassified_count := v_reclassified_count + 1;
      ELSE
        SELECT id INTO v_existing_journal_entry
        FROM journal_entries
        WHERE reference_type = 'bank_transaction'
          AND reference_id = v_transaction.id
          AND restaurant_id = p_restaurant_id
        LIMIT 1;

        IF v_existing_journal_entry IS NOT NULL THEN
          v_journal_entry_id := v_existing_journal_entry;
          DELETE FROM journal_entry_lines WHERE journal_entry_id = v_existing_journal_entry;
          UPDATE journal_entries
          SET description = v_transaction.description,
              total_debit = ABS(v_transaction.amount),
              total_credit = ABS(v_transaction.amount),
              updated_at = now()
          WHERE id = v_existing_journal_entry;
        ELSE
          INSERT INTO journal_entries (
            restaurant_id, entry_date, entry_number, description,
            reference_type, reference_id, total_debit, total_credit, created_by
          ) VALUES (
            p_restaurant_id,
            (v_transaction.transaction_date AT TIME ZONE 'UTC')::date,
            'BANK-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(clock_timestamp(), 'YYYYMMDD-HH24MISS-US'),
            v_transaction.description,
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

        v_categorized_count := v_categorized_count + 1;
      END IF;

      -- Bulk-only behavior kept from the current hook: clear the AI
      -- suggestion. The single RPC does not; this is deliberate.
      UPDATE bank_transactions
      SET category_id = p_category_id,
          is_categorized = true,
          suggested_category_id = NULL,
          updated_at = now()
      WHERE id = v_transaction.id;

      v_any_change := true;
    EXCEPTION WHEN OTHERS THEN
      -- One bad row must not abort the batch.
      v_skipped := v_skipped || jsonb_build_object('id', v_transaction.id, 'reason', SQLERRM);
    END;
  END LOOP;

  -- Ids in the input that do not resolve to a row in this tenant.
  FOR v_missing_id IN
    SELECT unnest(p_transaction_ids)
    EXCEPT
    SELECT id FROM bank_transactions
    WHERE id = ANY(p_transaction_ids)
      AND restaurant_id = p_restaurant_id
  LOOP
    v_skipped := v_skipped || jsonb_build_object('id', v_missing_id, 'reason', 'not_found');
  END LOOP;

  IF v_any_change THEN
    PERFORM rebuild_account_balances(p_restaurant_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'categorized_count', v_categorized_count,
    'reclassified_count', v_reclassified_count,
    'unchanged_count', v_unchanged_count,
    'skipped', v_skipped
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.bulk_categorize_bank_transactions(uuid[], uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.bulk_categorize_bank_transactions(uuid[], uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.bulk_categorize_bank_transactions(uuid[], uuid, uuid) TO authenticated;
