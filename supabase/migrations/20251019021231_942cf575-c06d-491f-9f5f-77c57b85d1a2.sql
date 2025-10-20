-- Step 1: Clean up duplicate journal entries
-- Keep only the most recent journal entry for each bank transaction
WITH duplicates AS (
  SELECT 
    id,
    reference_id,
    ROW_NUMBER() OVER (
      PARTITION BY reference_type, reference_id 
      ORDER BY created_at DESC
    ) as rn
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
)
DELETE FROM journal_entries
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Add unique constraint to prevent future duplicates
ALTER TABLE journal_entries 
ADD CONSTRAINT unique_journal_entry_reference 
UNIQUE (reference_type, reference_id);

-- Step 3: Create function to compute account balance from journal entries
CREATE OR REPLACE FUNCTION compute_account_balance(p_account_id UUID, p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_normal_balance TEXT;
BEGIN
  SELECT normal_balance INTO v_normal_balance
  FROM chart_of_accounts
  WHERE id = p_account_id;
  
  IF v_normal_balance = 'debit' THEN
    SELECT COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0)
    INTO v_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE jel.account_id = p_account_id
      AND je.entry_date <= p_as_of_date;
  ELSE
    SELECT COALESCE(SUM(jel.credit_amount - jel.debit_amount), 0)
    INTO v_balance
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE jel.account_id = p_account_id
      AND je.entry_date <= p_as_of_date;
  END IF;
  
  RETURN v_balance;
END;
$$;

-- Step 4: Create function to rebuild all account balances
CREATE OR REPLACE FUNCTION rebuild_account_balances(p_restaurant_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account RECORD;
  v_updated_count INTEGER := 0;
BEGIN
  FOR v_account IN 
    SELECT id FROM chart_of_accounts 
    WHERE restaurant_id = p_restaurant_id AND is_active = true
  LOOP
    UPDATE chart_of_accounts
    SET current_balance = compute_account_balance(v_account.id)
    WHERE id = v_account.id;
    
    v_updated_count := v_updated_count + 1;
  END LOOP;
  
  RETURN v_updated_count;
END;
$$;

-- Step 5: Add performance indexes
CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_account_date 
ON journal_entry_lines(account_id) 
INCLUDE (debit_amount, credit_amount);

CREATE INDEX IF NOT EXISTS idx_journal_entries_date 
ON journal_entries(entry_date);

-- Step 6: Create function to handle transaction categorization with deduplication
CREATE OR REPLACE FUNCTION categorize_bank_transaction(
  p_transaction_id UUID,
  p_category_id UUID,
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transaction RECORD;
  v_bank_account_id UUID;
  v_existing_journal_entry_id UUID;
  v_new_journal_entry_id UUID;
  v_entry_number TEXT;
  v_abs_amount NUMERIC;
  v_is_expense BOOLEAN;
BEGIN
  SELECT * INTO v_transaction
  FROM bank_transactions
  WHERE id = p_transaction_id AND restaurant_id = p_restaurant_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  
  SELECT id INTO v_bank_account_id
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_type = 'asset'
    AND account_subtype = 'cash'
    AND is_active = true
  LIMIT 1;
  
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'No active bank account found';
  END IF;
  
  SELECT id INTO v_existing_journal_entry_id
  FROM journal_entries
  WHERE reference_type = 'bank_transaction'
    AND reference_id = p_transaction_id;
  
  IF v_existing_journal_entry_id IS NOT NULL THEN
    IF v_transaction.category_id = p_category_id THEN
      RETURN jsonb_build_object(
        'success', true,
        'message', 'Transaction already categorized to this category',
        'journal_entry_id', v_existing_journal_entry_id
      );
    END IF;
    
    v_entry_number := 'REVERSE-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || SUBSTRING(p_transaction_id::TEXT, 1, 8);
    
    INSERT INTO journal_entries (
      restaurant_id, entry_date, entry_number, description,
      reference_type, reference_id, created_by
    )
    VALUES (
      p_restaurant_id,
      v_transaction.transaction_date,
      v_entry_number,
      'Reversing entry - Recategorization',
      'reversal',
      v_existing_journal_entry_id,
      auth.uid()
    )
    RETURNING id INTO v_new_journal_entry_id;
    
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    SELECT 
      v_new_journal_entry_id,
      account_id,
      credit_amount,
      debit_amount,
      'Reversal: ' || description
    FROM journal_entry_lines
    WHERE journal_entry_id = v_existing_journal_entry_id;
    
    UPDATE journal_entries je
    SET 
      total_debit = (SELECT SUM(debit_amount) FROM journal_entry_lines WHERE journal_entry_id = je.id),
      total_credit = (SELECT SUM(credit_amount) FROM journal_entry_lines WHERE journal_entry_id = je.id)
    WHERE id = v_new_journal_entry_id;
  END IF;
  
  v_entry_number := 'CAT-' || EXTRACT(EPOCH FROM NOW())::BIGINT || '-' || SUBSTRING(p_transaction_id::TEXT, 1, 8);
  v_abs_amount := ABS(v_transaction.amount);
  v_is_expense := v_transaction.amount < 0;
  
  INSERT INTO journal_entries (
    restaurant_id, entry_date, entry_number, description,
    reference_type, reference_id, created_by
  )
  VALUES (
    p_restaurant_id,
    v_transaction.transaction_date,
    v_entry_number,
    COALESCE(v_transaction.description, 'Transaction') || ' - Categorization',
    'bank_transaction',
    p_transaction_id,
    auth.uid()
  )
  RETURNING id INTO v_new_journal_entry_id;
  
  IF v_is_expense THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_new_journal_entry_id, p_category_id, v_abs_amount, 0, 'Expense'),
      (v_new_journal_entry_id, v_bank_account_id, 0, v_abs_amount, 'Payment');
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description)
    VALUES 
      (v_new_journal_entry_id, v_bank_account_id, v_abs_amount, 0, 'Deposit'),
      (v_new_journal_entry_id, p_category_id, 0, v_abs_amount, 'Revenue');
  END IF;
  
  UPDATE journal_entries
  SET 
    total_debit = v_abs_amount,
    total_credit = v_abs_amount,
    is_balanced = true
  WHERE id = v_new_journal_entry_id;
  
  UPDATE bank_transactions
  SET 
    category_id = p_category_id,
    is_categorized = true
  WHERE id = p_transaction_id;
  
  RETURN jsonb_build_object(
    'success', true,
    'message', 'Transaction categorized successfully',
    'journal_entry_id', v_new_journal_entry_id,
    'reversed_entry_id', v_existing_journal_entry_id
  );
END;
$$;