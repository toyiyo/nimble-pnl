-- Create function to categorize bank transaction and generate journal entries
CREATE OR REPLACE FUNCTION public.categorize_bank_transaction(
  p_transaction_id UUID,
  p_category_id UUID,
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transaction RECORD;
  v_category RECORD;
  v_cash_account RECORD;
  v_journal_entry_id UUID;
  v_entry_number TEXT;
BEGIN
  -- Get transaction details
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id
    AND restaurant_id = p_restaurant_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Get category account details
  SELECT * INTO v_category
  FROM chart_of_accounts
  WHERE id = p_category_id
    AND restaurant_id = p_restaurant_id;

  IF v_category.id IS NULL THEN
    RAISE EXCEPTION 'Category account not found';
  END IF;

  -- Get Cash account (account_code 1000)
  SELECT * INTO v_cash_account
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account.id IS NULL THEN
    RAISE EXCEPTION 'Cash account not found';
  END IF;

  -- Generate entry number
  v_entry_number := 'BANK-' || TO_CHAR(v_transaction.transaction_date, 'YYYYMMDD') || '-' || SUBSTRING(v_transaction.id::TEXT, 1, 8);

  -- Create journal entry
  INSERT INTO journal_entries (
    restaurant_id,
    entry_date,
    entry_number,
    description,
    reference_type,
    reference_id,
    total_debit,
    total_credit
  ) VALUES (
    p_restaurant_id,
    v_transaction.transaction_date,
    v_entry_number,
    COALESCE(v_transaction.merchant_name, v_transaction.description),
    'bank_transaction',
    v_transaction.id,
    ABS(v_transaction.amount),
    ABS(v_transaction.amount)
  )
  RETURNING id INTO v_journal_entry_id;

  -- Create journal entry lines based on transaction type
  IF v_transaction.amount < 0 THEN
    -- Money going OUT (expense/asset purchase)
    -- Debit: Expense/Asset account
    -- Credit: Cash account
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES
    (
      v_journal_entry_id,
      v_category.id,
      ABS(v_transaction.amount),
      0,
      COALESCE(v_transaction.merchant_name, v_transaction.description)
    ),
    (
      v_journal_entry_id,
      v_cash_account.id,
      0,
      ABS(v_transaction.amount),
      'Payment from ' || v_cash_account.account_name
    );
  ELSE
    -- Money coming IN (revenue/refund)
    -- Debit: Cash account
    -- Credit: Revenue/Liability account
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES
    (
      v_journal_entry_id,
      v_cash_account.id,
      ABS(v_transaction.amount),
      0,
      'Deposit to ' || v_cash_account.account_name
    ),
    (
      v_journal_entry_id,
      v_category.id,
      0,
      ABS(v_transaction.amount),
      COALESCE(v_transaction.merchant_name, v_transaction.description)
    );
  END IF;

  -- Update transaction as categorized
  UPDATE bank_transactions
  SET 
    category_id = p_category_id,
    is_categorized = true,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- Rebuild account balances
  PERFORM rebuild_account_balances(p_restaurant_id);

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_entry_id,
    'transaction_id', v_transaction.id,
    'amount', v_transaction.amount
  );
END;
$$;

-- Create function to handle split transactions
CREATE OR REPLACE FUNCTION public.categorize_bank_transaction_split(
  p_transaction_id UUID,
  p_splits JSONB,
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transaction RECORD;
  v_cash_account RECORD;
  v_journal_entry_id UUID;
  v_entry_number TEXT;
  v_split JSONB;
  v_split_account RECORD;
  v_total_splits NUMERIC := 0;
BEGIN
  -- Get transaction details
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id
    AND restaurant_id = p_restaurant_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Validate splits sum to transaction amount
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    v_total_splits := v_total_splits + (v_split->>'amount')::NUMERIC;
  END LOOP;

  IF ABS(v_total_splits - ABS(v_transaction.amount)) > 0.01 THEN
    RAISE EXCEPTION 'Split amounts (%) do not equal transaction amount (%)', 
      v_total_splits, ABS(v_transaction.amount);
  END IF;

  -- Get Cash account
  SELECT * INTO v_cash_account
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  IF v_cash_account.id IS NULL THEN
    RAISE EXCEPTION 'Cash account not found';
  END IF;

  -- Generate entry number
  v_entry_number := 'BANK-SPLIT-' || TO_CHAR(v_transaction.transaction_date, 'YYYYMMDD') || '-' || SUBSTRING(v_transaction.id::TEXT, 1, 8);

  -- Create journal entry
  INSERT INTO journal_entries (
    restaurant_id,
    entry_date,
    entry_number,
    description,
    reference_type,
    reference_id,
    total_debit,
    total_credit
  ) VALUES (
    p_restaurant_id,
    v_transaction.transaction_date,
    v_entry_number,
    'Split: ' || COALESCE(v_transaction.merchant_name, v_transaction.description),
    'bank_transaction',
    v_transaction.id,
    ABS(v_transaction.amount),
    ABS(v_transaction.amount)
  )
  RETURNING id INTO v_journal_entry_id;

  -- Create lines for each split
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    SELECT * INTO v_split_account
    FROM chart_of_accounts
    WHERE id = (v_split->>'category_id')::UUID
      AND restaurant_id = p_restaurant_id;

    IF v_split_account.id IS NULL THEN
      RAISE EXCEPTION 'Split category account not found';
    END IF;

    -- Create split line (debit for expense)
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES (
      v_journal_entry_id,
      v_split_account.id,
      CASE WHEN v_transaction.amount < 0 THEN (v_split->>'amount')::NUMERIC ELSE 0 END,
      CASE WHEN v_transaction.amount > 0 THEN (v_split->>'amount')::NUMERIC ELSE 0 END,
      v_split->>'description'
    );

    -- Store split in bank_transaction_splits
    INSERT INTO bank_transaction_splits (
      transaction_id,
      category_id,
      amount,
      description
    ) VALUES (
      v_transaction.id,
      v_split_account.id,
      (v_split->>'amount')::NUMERIC,
      v_split->>'description'
    );
  END LOOP;

  -- Create cash line (credit for expense)
  INSERT INTO journal_entry_lines (
    journal_entry_id,
    account_id,
    debit_amount,
    credit_amount,
    description
  ) VALUES (
    v_journal_entry_id,
    v_cash_account.id,
    CASE WHEN v_transaction.amount > 0 THEN ABS(v_transaction.amount) ELSE 0 END,
    CASE WHEN v_transaction.amount < 0 THEN ABS(v_transaction.amount) ELSE 0 END,
    'Payment from ' || v_cash_account.account_name
  );

  -- Update transaction as categorized and split
  UPDATE bank_transactions
  SET 
    is_categorized = true,
    is_split = true,
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- Rebuild account balances
  PERFORM rebuild_account_balances(p_restaurant_id);

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_entry_id,
    'transaction_id', v_transaction.id,
    'splits', jsonb_array_length(p_splits)
  );
END;
$$;