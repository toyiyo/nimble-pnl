-- Add transaction status enum type
CREATE TYPE transaction_review_status AS ENUM ('for_review', 'categorized', 'excluded', 'reconciled');

-- Add new columns to bank_transactions for review workflow
ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS status transaction_review_status NOT NULL DEFAULT 'for_review',
  ADD COLUMN IF NOT EXISTS suggested_category_id uuid REFERENCES chart_of_accounts(id),
  ADD COLUMN IF NOT EXISTS suggested_payee text,
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transfer_pair_id uuid REFERENCES bank_transactions(id),
  ADD COLUMN IF NOT EXISTS normalized_payee text,
  ADD COLUMN IF NOT EXISTS match_confidence numeric CHECK (match_confidence >= 0 AND match_confidence <= 1),
  ADD COLUMN IF NOT EXISTS excluded_reason text;

-- Create index for faster filtering by status
CREATE INDEX IF NOT EXISTS idx_bank_transactions_status ON bank_transactions(restaurant_id, status);

-- Create index for transfer pairs
CREATE INDEX IF NOT EXISTS idx_bank_transactions_transfer_pair ON bank_transactions(transfer_pair_id) WHERE transfer_pair_id IS NOT NULL;

-- Create index for suggested categories
CREATE INDEX IF NOT EXISTS idx_bank_transactions_suggested_category ON bank_transactions(suggested_category_id) WHERE suggested_category_id IS NOT NULL;

-- Update existing categorize_bank_transaction function to handle new workflow
CREATE OR REPLACE FUNCTION public.categorize_bank_transaction(
  p_transaction_id uuid,
  p_category_id uuid,
  p_description text DEFAULT NULL,
  p_is_split boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction RECORD;
  v_category RECORD;
  v_is_reclassification boolean := false;
  v_original_category_id uuid;
  v_journal_entry_id uuid;
  v_cash_account RECORD;
  v_fiscal_period RECORD;
BEGIN
  -- Get transaction details
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  -- Check if transaction is reconciled (cannot modify)
  IF v_transaction.is_reconciled THEN
    RAISE EXCEPTION 'Cannot categorize a reconciled transaction. Use reclassification instead.';
  END IF;

  -- Check if this is a reclassification
  IF v_transaction.is_categorized AND v_transaction.category_id IS NOT NULL THEN
    v_is_reclassification := true;
    v_original_category_id := v_transaction.category_id;
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
      'RECLASS-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS'),
      COALESCE(p_description, 'Reclassification: ' || v_transaction.description),
      'reclassification',
      v_transaction.id,
      ABS(v_transaction.amount),
      ABS(v_transaction.amount),
      auth.uid()
    )
    RETURNING id INTO v_journal_entry_id;

    -- Post reclassification lines (move from old category to new category)
    IF v_transaction.amount < 0 THEN
      -- Expense/debit transaction
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, p_category_id, ABS(v_transaction.amount), 0, 'Reclassify to ' || v_category.account_name),
        (v_journal_entry_id, v_original_category_id, 0, ABS(v_transaction.amount), 'Reclassify from previous category');
    ELSE
      -- Income/credit transaction
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
    -- Initial categorization - create new journal entry
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
      'BANK-' || v_transaction.stripe_transaction_id,
      COALESCE(p_description, v_transaction.description),
      'bank_transaction',
      v_transaction.id,
      ABS(v_transaction.amount),
      ABS(v_transaction.amount),
      auth.uid()
    )
    RETURNING id INTO v_journal_entry_id;

    -- Post journal entry lines based on transaction type
    IF v_transaction.amount < 0 THEN
      -- Money out (expense/debit)
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, p_category_id, ABS(v_transaction.amount), 0, v_category.account_name),
        (v_journal_entry_id, v_cash_account.id, 0, ABS(v_transaction.amount), 'Cash payment');
    ELSE
      -- Money in (revenue/credit)
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
      VALUES
        (v_journal_entry_id, v_cash_account.id, ABS(v_transaction.amount), 0, 'Cash received'),
        (v_journal_entry_id, p_category_id, 0, ABS(v_transaction.amount), v_category.account_name);
    END IF;
  END IF;

  -- Update transaction status
  UPDATE bank_transactions
  SET
    category_id = p_category_id,
    is_categorized = true,
    status = 'categorized',
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

-- Add function to exclude transaction from accounting
CREATE OR REPLACE FUNCTION public.exclude_bank_transaction(
  p_transaction_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_transaction RECORD;
BEGIN
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id;

  IF v_transaction.id IS NULL THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;

  IF v_transaction.is_reconciled THEN
    RAISE EXCEPTION 'Cannot exclude a reconciled transaction';
  END IF;

  IF v_transaction.is_categorized THEN
    RAISE EXCEPTION 'Cannot exclude a categorized transaction. Uncategorize it first.';
  END IF;

  UPDATE bank_transactions
  SET
    status = 'excluded',
    excluded_reason = p_reason,
    updated_at = now()
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id
  );
END;
$function$;

-- Add function to mark transactions as transfers
CREATE OR REPLACE FUNCTION public.mark_as_transfer(
  p_transaction_id_1 uuid,
  p_transaction_id_2 uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_txn1 RECORD;
  v_txn2 RECORD;
  v_journal_entry_id uuid;
  v_account1 RECORD;
  v_account2 RECORD;
BEGIN
  -- Get both transactions
  SELECT * INTO v_txn1 FROM bank_transactions WHERE id = p_transaction_id_1;
  SELECT * INTO v_txn2 FROM bank_transactions WHERE id = p_transaction_id_2;

  IF v_txn1.id IS NULL OR v_txn2.id IS NULL THEN
    RAISE EXCEPTION 'One or both transactions not found';
  END IF;

  IF v_txn1.restaurant_id != v_txn2.restaurant_id THEN
    RAISE EXCEPTION 'Transactions must belong to the same restaurant';
  END IF;

  -- Verify amounts match (opposite signs)
  IF ABS(v_txn1.amount + v_txn2.amount) > 0.01 THEN
    RAISE EXCEPTION 'Transfer amounts must match';
  END IF;

  -- Get bank accounts
  SELECT coa.* INTO v_account1
  FROM chart_of_accounts coa
  JOIN connected_banks cb ON cb.id = v_txn1.connected_bank_id
  WHERE coa.restaurant_id = v_txn1.restaurant_id
    AND coa.account_code = '1000'
  LIMIT 1;

  SELECT coa.* INTO v_account2
  FROM chart_of_accounts coa
  JOIN connected_banks cb ON cb.id = v_txn2.connected_bank_id
  WHERE coa.restaurant_id = v_txn2.restaurant_id
    AND coa.account_code = '1000'
  LIMIT 1;

  -- Create journal entry for transfer
  INSERT INTO journal_entries (
    restaurant_id,
    entry_date,
    entry_number,
    description,
    reference_type,
    total_debit,
    total_credit,
    created_by
  ) VALUES (
    v_txn1.restaurant_id,
    GREATEST(v_txn1.transaction_date, v_txn2.transaction_date),
    'TRANSFER-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS'),
    'Transfer between accounts',
    'bank_transfer',
    ABS(v_txn1.amount),
    ABS(v_txn1.amount),
    auth.uid()
  )
  RETURNING id INTO v_journal_entry_id;

  -- Post transfer lines
  IF v_txn1.amount > 0 THEN
    -- txn1 is deposit, txn2 is withdrawal
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES
      (v_journal_entry_id, v_account1.id, ABS(v_txn1.amount), 0, 'Transfer in'),
      (v_journal_entry_id, v_account2.id, 0, ABS(v_txn2.amount), 'Transfer out');
  ELSE
    -- txn1 is withdrawal, txn2 is deposit
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES
      (v_journal_entry_id, v_account2.id, ABS(v_txn2.amount), 0, 'Transfer in'),
      (v_journal_entry_id, v_account1.id, 0, ABS(v_txn1.amount), 'Transfer out');
  END IF;

  -- Update both transactions
  UPDATE bank_transactions
  SET
    is_transfer = true,
    transfer_pair_id = p_transaction_id_2,
    status = 'categorized',
    is_categorized = true,
    updated_at = now()
  WHERE id = p_transaction_id_1;

  UPDATE bank_transactions
  SET
    is_transfer = true,
    transfer_pair_id = p_transaction_id_1,
    status = 'categorized',
    is_categorized = true,
    updated_at = now()
  WHERE id = p_transaction_id_2;

  PERFORM rebuild_account_balances(v_txn1.restaurant_id);

  RETURN jsonb_build_object(
    'success', true,
    'journal_entry_id', v_journal_entry_id,
    'transaction_ids', jsonb_build_array(p_transaction_id_1, p_transaction_id_2)
  );
END;
$function$;