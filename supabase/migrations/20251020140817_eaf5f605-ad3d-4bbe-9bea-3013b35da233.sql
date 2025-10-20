-- Phase 2.1: Add supplier integration to bank transactions

-- Add supplier_id to bank_transactions
ALTER TABLE bank_transactions 
ADD COLUMN supplier_id uuid REFERENCES suppliers(id);

CREATE INDEX idx_bank_transactions_supplier ON bank_transactions(supplier_id);

-- Store supplier name variations for matching
CREATE TABLE supplier_name_variations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE NOT NULL,
  name_variation text NOT NULL,
  match_type text NOT NULL CHECK (match_type IN ('exact', 'fuzzy', 'alias')),
  created_at timestamptz DEFAULT now(),
  UNIQUE(supplier_id, name_variation)
);

-- RLS policies for supplier_name_variations
ALTER TABLE supplier_name_variations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage supplier variations for their restaurants"
ON supplier_name_variations
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = supplier_name_variations.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'chef')
  )
);

-- Auto-categorization rules based on suppliers
CREATE TABLE supplier_categorization_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE NOT NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE CASCADE NOT NULL,
  default_category_id uuid REFERENCES chart_of_accounts(id),
  auto_apply boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(restaurant_id, supplier_id)
);

-- RLS policies for supplier_categorization_rules
ALTER TABLE supplier_categorization_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage categorization rules for their restaurants"
ON supplier_categorization_rules
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = supplier_categorization_rules.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'chef')
  )
);

-- Function to suggest supplier based on payee name
CREATE OR REPLACE FUNCTION suggest_supplier_for_payee(
  p_restaurant_id uuid,
  p_payee_name text
)
RETURNS TABLE (
  supplier_id uuid,
  supplier_name text,
  match_confidence numeric,
  match_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  -- Exact matches on supplier name
  SELECT 
    s.id,
    s.name,
    1.0::numeric as match_confidence,
    'exact'::text as match_type
  FROM suppliers s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.is_active = true
    AND LOWER(s.name) = LOWER(p_payee_name)
  
  UNION ALL
  
  -- Exact matches on name variations
  SELECT 
    s.id,
    s.name,
    0.95::numeric,
    'alias'::text
  FROM suppliers s
  JOIN supplier_name_variations snv ON snv.supplier_id = s.id
  WHERE s.restaurant_id = p_restaurant_id
    AND s.is_active = true
    AND snv.match_type = 'exact'
    AND LOWER(snv.name_variation) = LOWER(p_payee_name)
  
  UNION ALL
  
  -- Fuzzy matches (contains)
  SELECT 
    s.id,
    s.name,
    0.7::numeric,
    'fuzzy'::text
  FROM suppliers s
  WHERE s.restaurant_id = p_restaurant_id
    AND s.is_active = true
    AND (
      LOWER(p_payee_name) LIKE '%' || LOWER(s.name) || '%'
      OR LOWER(s.name) LIKE '%' || LOWER(p_payee_name) || '%'
    )
  
  ORDER BY match_confidence DESC, supplier_name
  LIMIT 5;
END;
$$;

-- Update categorize_bank_transaction to accept supplier_id
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

  -- Check if this is a reclassification
  IF v_transaction.is_categorized AND v_transaction.category_id IS NOT NULL THEN
    v_is_reclassification := true;
    v_original_category_id := v_transaction.category_id;
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
    INSERT INTO journal_entries (
      restaurant_id, entry_date, entry_number, description,
      reference_type, reference_id, total_debit, total_credit, created_by
    ) VALUES (
      v_transaction.restaurant_id, v_transaction.transaction_date,
      'RECLASS-' || v_transaction.id::text || '-' || TO_CHAR(now(), 'YYYYMMDD-HH24MISS-US'),
      COALESCE(p_description, 'Reclassification: ' || v_transaction.description),
      'reclassification', v_transaction.id,
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

  -- Update transaction with notes, payee, and supplier
  UPDATE bank_transactions
  SET
    category_id = p_category_id,
    is_categorized = true,
    notes = p_description,
    normalized_payee = COALESCE(p_normalized_payee, normalized_payee),
    supplier_id = p_supplier_id,
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