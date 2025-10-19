-- Create reconciliation boundaries table to track opening balance dates
CREATE TABLE IF NOT EXISTS public.reconciliation_boundaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  balance_start_date DATE NOT NULL,
  opening_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  opening_balance_journal_entry_id UUID REFERENCES public.journal_entries(id),
  last_reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(restaurant_id)
);

CREATE INDEX idx_reconciliation_boundaries_restaurant ON public.reconciliation_boundaries(restaurant_id);

-- Enable RLS
ALTER TABLE public.reconciliation_boundaries ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view reconciliation boundaries for their restaurants"
  ON public.reconciliation_boundaries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = reconciliation_boundaries.restaurant_id
        AND user_restaurants.user_id = auth.uid()
    )
  );

CREATE POLICY "Owners and managers can manage reconciliation boundaries"
  ON public.reconciliation_boundaries
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_restaurants
      WHERE user_restaurants.restaurant_id = reconciliation_boundaries.restaurant_id
        AND user_restaurants.user_id = auth.uid()
        AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Function to check for and fix reconciliation boundary violations
CREATE OR REPLACE FUNCTION public.check_reconciliation_boundary(
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_boundary RECORD;
  v_older_transactions_sum NUMERIC := 0;
  v_adjustment_needed NUMERIC := 0;
  v_earliest_transaction_date DATE;
  v_result JSONB;
BEGIN
  -- Get the reconciliation boundary if it exists
  SELECT * INTO v_boundary
  FROM reconciliation_boundaries
  WHERE restaurant_id = p_restaurant_id;

  -- If no boundary exists, no violations possible
  IF v_boundary.id IS NULL THEN
    RETURN jsonb_build_object(
      'has_violation', false,
      'message', 'No reconciliation boundary set'
    );
  END IF;

  -- Find earliest transaction date
  SELECT MIN(transaction_date) INTO v_earliest_transaction_date
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id;

  -- Check if any transactions precede the boundary
  IF v_earliest_transaction_date IS NULL OR v_earliest_transaction_date >= v_boundary.balance_start_date THEN
    RETURN jsonb_build_object(
      'has_violation', false,
      'message', 'No transactions precede reconciliation boundary'
    );
  END IF;

  -- Calculate sum of transactions that precede the boundary
  SELECT COALESCE(SUM(amount), 0) INTO v_older_transactions_sum
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id
    AND transaction_date < v_boundary.balance_start_date
    AND is_categorized = true;

  -- Calculate adjustment needed
  v_adjustment_needed := -v_older_transactions_sum;

  RETURN jsonb_build_object(
    'has_violation', true,
    'boundary_date', v_boundary.balance_start_date,
    'earliest_transaction_date', v_earliest_transaction_date,
    'older_transactions_sum', v_older_transactions_sum,
    'adjustment_needed', v_adjustment_needed,
    'current_opening_balance', v_boundary.opening_balance,
    'new_opening_balance', v_boundary.opening_balance + v_adjustment_needed
  );
END;
$$;

-- Function to apply reconciliation adjustment
CREATE OR REPLACE FUNCTION public.apply_reconciliation_adjustment(
  p_restaurant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_check_result JSONB;
  v_boundary RECORD;
  v_cash_account RECORD;
  v_equity_account RECORD;
  v_adjustment_amount NUMERIC;
  v_new_opening_balance NUMERIC;
  v_journal_entry_id UUID;
  v_earliest_date DATE;
BEGIN
  -- Check if adjustment is needed
  v_check_result := check_reconciliation_boundary(p_restaurant_id);

  IF NOT (v_check_result->>'has_violation')::boolean THEN
    RETURN jsonb_build_object(
      'adjusted', false,
      'message', v_check_result->>'message'
    );
  END IF;

  -- Get boundary info
  SELECT * INTO v_boundary
  FROM reconciliation_boundaries
  WHERE restaurant_id = p_restaurant_id;

  -- Get accounts
  SELECT * INTO v_cash_account
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '1000'
  LIMIT 1;

  SELECT * INTO v_equity_account
  FROM chart_of_accounts
  WHERE restaurant_id = p_restaurant_id
    AND account_code = '3000'
  LIMIT 1;

  IF v_cash_account.id IS NULL OR v_equity_account.id IS NULL THEN
    RAISE EXCEPTION 'Required accounts not found';
  END IF;

  v_adjustment_amount := (v_check_result->>'adjustment_needed')::numeric;
  v_new_opening_balance := (v_check_result->>'new_opening_balance')::numeric;
  v_earliest_date := (v_check_result->>'earliest_transaction_date')::date;

  -- Create adjustment journal entry
  INSERT INTO journal_entries (
    restaurant_id,
    entry_date,
    entry_number,
    description,
    reference_type,
    total_debit,
    total_credit
  ) VALUES (
    p_restaurant_id,
    v_earliest_date,
    'RECON-ADJ-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS'),
    'Reconciliation adjustment for historical transactions',
    'reconciliation_adjustment',
    ABS(v_adjustment_amount),
    ABS(v_adjustment_amount)
  )
  RETURNING id INTO v_journal_entry_id;

  -- Post adjustment lines (reverse the over-statement)
  IF v_adjustment_amount < 0 THEN
    -- Need to reduce opening balance (credit cash, debit equity)
    INSERT INTO journal_entry_lines (
      journal_entry_id,
      account_id,
      debit_amount,
      credit_amount,
      description
    ) VALUES
    (
      v_journal_entry_id,
      v_equity_account.id,
      ABS(v_adjustment_amount),
      0,
      'Reconciliation adjustment - reduce equity'
    ),
    (
      v_journal_entry_id,
      v_cash_account.id,
      0,
      ABS(v_adjustment_amount),
      'Reconciliation adjustment - reduce cash'
    );
  ELSE
    -- Need to increase opening balance (debit cash, credit equity)
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
      ABS(v_adjustment_amount),
      0,
      'Reconciliation adjustment - increase cash'
    ),
    (
      v_journal_entry_id,
      v_equity_account.id,
      0,
      ABS(v_adjustment_amount),
      'Reconciliation adjustment - increase equity'
    );
  END IF;

  -- Update reconciliation boundary with new date and balance
  UPDATE reconciliation_boundaries
  SET 
    balance_start_date = v_earliest_date,
    opening_balance = v_new_opening_balance,
    last_reconciled_at = now(),
    updated_at = now()
  WHERE restaurant_id = p_restaurant_id;

  -- Rebuild balances
  PERFORM rebuild_account_balances(p_restaurant_id);

  RETURN jsonb_build_object(
    'adjusted', true,
    'adjustment_amount', v_adjustment_amount,
    'old_opening_balance', v_boundary.opening_balance,
    'new_opening_balance', v_new_opening_balance,
    'old_boundary_date', v_boundary.balance_start_date,
    'new_boundary_date', v_earliest_date,
    'journal_entry_id', v_journal_entry_id
  );
END;
$$;