-- Function to split a transaction across multiple categories
CREATE OR REPLACE FUNCTION public.split_bank_transaction(
  p_transaction_id uuid,
  p_splits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction RECORD;
  v_split RECORD;
  v_total_split_amount NUMERIC := 0;
  v_journal_entry_id uuid;
  v_cash_account RECORD;
  v_fiscal_period RECORD;
  v_category RECORD;
BEGIN
  -- Get transaction details
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Check if transaction is already categorized or reconciled
  IF v_transaction.is_categorized THEN
    RAISE EXCEPTION 'Transaction is already categorized';
  END IF;

  IF v_transaction.is_reconciled THEN
    RAISE EXCEPTION 'Cannot split a reconciled transaction';
  END IF;

  -- Validate splits total matches transaction amount
  FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(category_id uuid, amount numeric, description text)
  LOOP
    v_total_split_amount := v_total_split_amount + v_split.amount;
  END LOOP;

  IF ABS(ABS(v_transaction.amount) - v_total_split_amount) > 0.01 THEN
    RAISE EXCEPTION 'Split amounts (%) do not match transaction amount (%)', 
      v_total_split_amount, ABS(v_transaction.amount);
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
    RAISE EXCEPTION 'Cannot split transaction in closed fiscal period';
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

  -- Create journal entry for split transaction
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
    'SPLIT-' || v_transaction.stripe_transaction_id,
    'Split transaction: ' || v_transaction.description,
    'bank_transaction',
    v_transaction.id,
    ABS(v_transaction.amount),
    ABS(v_transaction.amount),
    auth.uid()
  )
  RETURNING id INTO v_journal_entry_id;

  -- Post journal entry lines for each split
  FOR v_split IN SELECT * FROM jsonb_to_recordset(p_splits) AS x(category_id uuid, amount numeric, description text)
  LOOP
    -- Get category details
    SELECT * INTO v_category
    FROM chart_of_accounts
    WHERE id = v_split.category_id
      AND restaurant_id = v_transaction.restaurant_id
      AND is_active = true;

    IF v_category.id IS NULL THEN
      RAISE EXCEPTION 'Category not found or inactive: %', v_split.category_id;
    END IF;

    -- Create split record
    INSERT INTO bank_transaction_splits (
      transaction_id,
      category_id,
      amount,
      description
    ) VALUES (
      v_transaction.id,
      v_split.category_id,
      v_split.amount,
      v_split.description
    );

    -- Post journal lines based on transaction type
    IF v_transaction.amount < 0 THEN
      -- Money out (expense/debit) - debit expense accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
      ) VALUES (
        v_journal_entry_id,
        v_split.category_id,
        v_split.amount,
        0,
        COALESCE(v_split.description, v_category.account_name)
      );
    ELSE
      -- Money in (revenue/credit) - credit revenue accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id,
        account_id,
        debit_amount,
        credit_amount,
        description
      ) VALUES (
        v_journal_entry_id,
        v_split.category_id,
        0,
        v_split.amount,
        COALESCE(v_split.description, v_category.account_name)
      );
    END IF;
  END LOOP;

  -- Post the offsetting cash line
  IF v_transaction.amount < 0 THEN
    -- Money out - credit cash
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_cash_account.id,
      0,
      ABS(v_transaction.amount),
      'Cash payment (split)'
    );
  ELSE
    -- Money in - debit cash
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_cash_account.id,
      ABS(v_transaction.amount),
      0,
      'Cash received (split)'
    );
  END IF;

  -- Update transaction status
  UPDATE bank_transactions
  SET
    is_split = true,
    is_categorized = true,
    status = 'categorized',
    updated_at = now()
  WHERE id = p_transaction_id;

  -- Rebuild account balances
  PERFORM rebuild_account_balances(v_transaction.restaurant_id);

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_entry_id,
    'transaction_id', p_transaction_id,
    'split_count', jsonb_array_length(p_splits)
  );
END;
$function$;