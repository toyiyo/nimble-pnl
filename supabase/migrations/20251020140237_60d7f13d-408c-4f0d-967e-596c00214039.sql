-- Update categorize_bank_transaction function to accept and save payee and notes
CREATE OR REPLACE FUNCTION public.categorize_bank_transaction(
  p_transaction_id uuid,
  p_category_id uuid,
  p_description text DEFAULT NULL,
  p_normalized_payee text DEFAULT NULL
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

  -- Check if this is a reclassification (must be done BEFORE reconciliation check)
  IF v_transaction.is_categorized AND v_transaction.category_id IS NOT NULL THEN
    v_is_reclassification := true;
    v_original_category_id := v_transaction.category_id;
  END IF;

  -- Block initial categorization of reconciled transactions, but allow reclassification
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

  -- ALWAYS check if a journal entry already exists for this transaction
  SELECT id INTO v_existing_journal_entry
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
    AND reference_id = v_transaction.id
    AND restaurant_id = v_transaction.restaurant_id
  LIMIT 1;

  -- Handle reclassification
  IF v_is_reclassification THEN
    -- Create reclassification journal entry
    INSERT INTO journal_entries (
      restaurant_id,
      entry_date,
      entry_number,
      description,
      reference_type,
      reference_id,
      total_debit,
      total_credit,
      created_by
    ) VALUES (
      v_transaction.restaurant_id,
      v_transaction.transaction_date,
      'RECLASS-' || v_transaction.id::text || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
      COALESCE(p_description, 'Reclassification: ' || v_transaction.description),
      'reclassification',
      v_transaction.id,
      ABS(v_transaction.amount),
      ABS(v_transaction.amount),
      auth.uid()
    )
    RETURNING id INTO v_journal_entry_id;

    -- Post reclassification lines
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

    -- Record reclassification
    INSERT INTO transaction_reclassifications (
      restaurant_id,
      bank_transaction_id,
      original_category_id,
      new_category_id,
      reclass_journal_entry_id,
      reason,
      created_by
    ) VALUES (
      v_transaction.restaurant_id,
      v_transaction.id,
      v_original_category_id,
      p_category_id,
      v_journal_entry_id,
      p_description,
      auth.uid()
    );
  ELSE
    -- Initial categorization
    IF v_existing_journal_entry IS NOT NULL THEN
      -- Journal entry already exists, use it
      v_journal_entry_id := v_existing_journal_entry;
      
      -- Delete existing journal entry lines
      DELETE FROM journal_entry_lines
      WHERE journal_entry_id = v_existing_journal_entry;
      
      -- Update journal entry details
      UPDATE journal_entries
      SET
        description = COALESCE(p_description, v_transaction.description),
        total_debit = ABS(v_transaction.amount),
        total_credit = ABS(v_transaction.amount),
        updated_at = now()
      WHERE id = v_existing_journal_entry;
    ELSE
      -- Create new journal entry
      INSERT INTO journal_entries (
        restaurant_id,
        entry_date,
        entry_number,
        description,
        reference_type,
        reference_id,
        total_debit,
        total_credit,
        created_by
      ) VALUES (
        v_transaction.restaurant_id,
        v_transaction.transaction_date,
        'BANK-' || COALESCE(v_transaction.stripe_transaction_id, v_transaction.id::text) || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
        COALESCE(p_description, v_transaction.description),
        'bank_transaction',
        v_transaction.id,
        ABS(v_transaction.amount),
        ABS(v_transaction.amount),
        auth.uid()
      )
      RETURNING id INTO v_journal_entry_id;
    END IF;

    -- Post journal entry lines
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

  -- Update transaction with notes and payee
  UPDATE bank_transactions
  SET
    category_id = p_category_id,
    is_categorized = true,
    notes = p_description,
    normalized_payee = COALESCE(p_normalized_payee, normalized_payee),
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