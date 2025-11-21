-- Add split categorization support to categorization_rules
-- This allows rules to automatically create splits across multiple categories

-- Add split configuration columns to categorization_rules
ALTER TABLE categorization_rules
  ADD COLUMN IF NOT EXISTS is_split_rule BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_config JSONB;

-- Add constraint to ensure split_config is provided when is_split_rule is true
ALTER TABLE categorization_rules
  ADD CONSTRAINT check_split_config CHECK (
    (is_split_rule = false AND split_config IS NULL) OR
    (is_split_rule = true AND split_config IS NOT NULL AND jsonb_array_length(split_config) >= 2)
  );

-- Add comment explaining split_config format
COMMENT ON COLUMN categorization_rules.split_config IS 
'JSONB array of split configurations. Each entry should have:
- category_id (UUID, required): Target category for this split
- percentage (number, 0-100): Percentage of total amount (mutually exclusive with amount)
- amount (number, positive): Fixed amount for this split (mutually exclusive with percentage)
- description (text, optional): Description for this split entry
Example: [{"category_id": "uuid1", "percentage": 60, "description": "Alcohol"}, {"category_id": "uuid2", "percentage": 40, "description": "Mixers"}]';

-- Function to validate split configuration
CREATE OR REPLACE FUNCTION validate_split_config(p_split_config JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_split JSONB;
  v_total_percentage NUMERIC := 0;
  v_has_percentage BOOLEAN := false;
  v_has_amount BOOLEAN := false;
BEGIN
  -- Check if array has at least 2 elements
  IF jsonb_array_length(p_split_config) < 2 THEN
    RAISE EXCEPTION 'Split configuration must have at least 2 entries';
  END IF;
  
  -- Validate each split entry
  FOR v_split IN SELECT jsonb_array_elements(p_split_config)
  LOOP
    -- Check required category_id
    IF v_split->>'category_id' IS NULL THEN
      RAISE EXCEPTION 'Each split entry must have a category_id';
    END IF;
    
    -- Check that either percentage or amount is provided, not both
    IF (v_split->>'percentage' IS NOT NULL AND v_split->>'amount' IS NOT NULL) THEN
      RAISE EXCEPTION 'Split entry cannot have both percentage and amount';
    END IF;
    
    IF (v_split->>'percentage' IS NULL AND v_split->>'amount' IS NULL) THEN
      RAISE EXCEPTION 'Split entry must have either percentage or amount';
    END IF;
    
    -- Track if using percentages or amounts (cannot mix)
    IF v_split->>'percentage' IS NOT NULL THEN
      v_has_percentage := true;
      v_total_percentage := v_total_percentage + (v_split->>'percentage')::NUMERIC;
    END IF;
    
    IF v_split->>'amount' IS NOT NULL THEN
      v_has_amount := true;
    END IF;
  END LOOP;
  
  -- Cannot mix percentage and amount splits
  IF v_has_percentage AND v_has_amount THEN
    RAISE EXCEPTION 'Cannot mix percentage-based and amount-based splits in the same rule';
  END IF;
  
  -- Validate total percentage equals 100
  IF v_has_percentage THEN
    IF ABS(v_total_percentage - 100) > 0.01 THEN
      RAISE EXCEPTION 'Split percentages must sum to 100, got %', v_total_percentage;
    END IF;
  END IF;
  
  RETURN true;
END;
$$;

-- Function to apply a split rule to a bank transaction
CREATE OR REPLACE FUNCTION apply_split_rule_to_bank_transaction(
  p_transaction_id UUID,
  p_rule_id UUID,
  p_transaction_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_split JSONB;
  v_split_amount NUMERIC;
  v_total_allocated NUMERIC := 0;
  v_remaining_amount NUMERIC;
  v_last_split_id UUID;
BEGIN
  -- Get the rule with split config
  SELECT * INTO v_rule
  FROM categorization_rules
  WHERE id = p_rule_id
    AND is_split_rule = true
    AND split_config IS NOT NULL;
  
  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Split rule not found or not configured for splits';
  END IF;
  
  -- Validate split config
  PERFORM validate_split_config(v_rule.split_config);
  
  -- Delete any existing splits for this transaction
  DELETE FROM bank_transaction_splits WHERE transaction_id = p_transaction_id;
  
  -- Use absolute value for calculation
  v_remaining_amount := ABS(p_transaction_amount);
  
  -- Create split entries
  FOR v_split IN SELECT jsonb_array_elements(v_rule.split_config)
  LOOP
    -- Calculate split amount
    IF v_split->>'percentage' IS NOT NULL THEN
      v_split_amount := ROUND(v_remaining_amount * (v_split->>'percentage')::NUMERIC / 100, 2);
    ELSE
      v_split_amount := (v_split->>'amount')::NUMERIC;
    END IF;
    
    v_total_allocated := v_total_allocated + v_split_amount;
    
    -- Insert split
    INSERT INTO bank_transaction_splits (
      transaction_id,
      category_id,
      amount,
      description
    )
    VALUES (
      p_transaction_id,
      (v_split->>'category_id')::UUID,
      v_split_amount,
      v_split->>'description'
    )
    RETURNING id INTO v_last_split_id;
  END LOOP;
  
  -- Handle rounding differences for percentage-based splits
  -- Adjust the last split if there's a small difference due to rounding
  IF v_rule.split_config->0->>'percentage' IS NOT NULL THEN
    IF ABS(v_total_allocated - v_remaining_amount) > 0 AND ABS(v_total_allocated - v_remaining_amount) <= 0.02 THEN
      UPDATE bank_transaction_splits
      SET amount = amount + (v_remaining_amount - v_total_allocated)
      WHERE id = v_last_split_id;
    ELSIF ABS(v_total_allocated - v_remaining_amount) > 0.02 THEN
      RAISE EXCEPTION 'Split amounts do not match transaction amount. Expected: %, Got: %', 
        v_remaining_amount, v_total_allocated;
    END IF;
  END IF;
  
  -- Mark transaction as split and categorized
  UPDATE bank_transactions
  SET 
    is_split = true,
    is_categorized = true,
    category_id = NULL  -- Clear single category since we're using splits
  WHERE id = p_transaction_id;
  
  -- Update rule statistics
  UPDATE categorization_rules
  SET 
    apply_count = apply_count + 1,
    last_applied_at = now()
  WHERE id = p_rule_id;
END;
$$;

-- Function to apply a split rule to a POS sale
CREATE OR REPLACE FUNCTION apply_split_rule_to_pos_sale(
  p_sale_id UUID,
  p_rule_id UUID,
  p_sale_amount NUMERIC
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_split JSONB;
  v_split_amount NUMERIC;
  v_total_allocated NUMERIC := 0;
  v_remaining_amount NUMERIC;
  v_last_split_id UUID;
BEGIN
  -- Get the rule with split config
  SELECT * INTO v_rule
  FROM categorization_rules
  WHERE id = p_rule_id
    AND is_split_rule = true
    AND split_config IS NOT NULL;
  
  IF v_rule.id IS NULL THEN
    RAISE EXCEPTION 'Split rule not found or not configured for splits';
  END IF;
  
  -- Validate split config
  PERFORM validate_split_config(v_rule.split_config);
  
  -- Delete any existing splits for this sale
  DELETE FROM unified_sales_splits WHERE sale_id = p_sale_id;
  
  -- Use absolute value for calculation
  v_remaining_amount := ABS(p_sale_amount);
  
  -- Create split entries
  FOR v_split IN SELECT jsonb_array_elements(v_rule.split_config)
  LOOP
    -- Calculate split amount
    IF v_split->>'percentage' IS NOT NULL THEN
      v_split_amount := ROUND(v_remaining_amount * (v_split->>'percentage')::NUMERIC / 100, 2);
    ELSE
      v_split_amount := (v_split->>'amount')::NUMERIC;
    END IF;
    
    v_total_allocated := v_total_allocated + v_split_amount;
    
    -- Insert split
    INSERT INTO unified_sales_splits (
      sale_id,
      category_id,
      amount,
      description
    )
    VALUES (
      p_sale_id,
      (v_split->>'category_id')::UUID,
      v_split_amount,
      v_split->>'description'
    )
    RETURNING id INTO v_last_split_id;
  END LOOP;
  
  -- Handle rounding differences for percentage-based splits
  -- Adjust the last split if there's a small difference due to rounding
  IF v_rule.split_config->0->>'percentage' IS NOT NULL THEN
    IF ABS(v_total_allocated - v_remaining_amount) > 0 AND ABS(v_total_allocated - v_remaining_amount) <= 0.02 THEN
      UPDATE unified_sales_splits
      SET amount = amount + (v_remaining_amount - v_total_allocated)
      WHERE id = v_last_split_id;
    ELSIF ABS(v_total_allocated - v_remaining_amount) > 0.02 THEN
      RAISE EXCEPTION 'Split amounts do not match sale amount. Expected: %, Got: %', 
        v_remaining_amount, v_total_allocated;
    END IF;
  END IF;
  
  -- Mark sale as split and categorized
  UPDATE unified_sales
  SET 
    is_split = true,
    is_categorized = true,
    category_id = NULL,  -- Clear single category since we're using splits
    suggested_category_id = NULL,
    ai_confidence = NULL,
    ai_reasoning = NULL
  WHERE id = p_sale_id;
  
  -- Update rule statistics
  UPDATE categorization_rules
  SET 
    apply_count = apply_count + 1,
    last_applied_at = now()
  WHERE id = p_rule_id;
END;
$$;

-- Update the auto-apply trigger for bank transactions to handle splits
CREATE OR REPLACE FUNCTION auto_apply_bank_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matching_rule RECORD;
  v_transaction_json JSONB;
BEGIN
  -- Skip if already categorized or split
  IF NEW.is_categorized = true OR NEW.is_split = true THEN
    RETURN NEW;
  END IF;
  
  -- Build transaction JSON for matching
  v_transaction_json := jsonb_build_object(
    'description', NEW.description,
    'amount', NEW.amount,
    'supplier_id', NEW.supplier_id,
    'transaction_type', CASE 
      WHEN NEW.amount < 0 THEN 'debit'
      WHEN NEW.amount > 0 THEN 'credit'
      ELSE 'any'
    END
  );
  
  -- Find highest priority matching rule
  SELECT 
    cr.id,
    cr.is_split_rule,
    cr.category_id,
    cr.auto_apply
  INTO v_matching_rule
  FROM categorization_rules cr
  WHERE cr.restaurant_id = NEW.restaurant_id
    AND cr.is_active = true
    AND cr.auto_apply = true
    AND cr.applies_to IN ('bank_transactions', 'both')
    AND matches_bank_transaction_rule(cr.id, v_transaction_json)
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
  
  -- Apply rule if found
  IF v_matching_rule.id IS NOT NULL THEN
    IF v_matching_rule.is_split_rule THEN
      -- Apply split rule after insert
      -- We can't call this in BEFORE trigger because the transaction doesn't exist yet
      -- So we'll mark it and handle in AFTER trigger
      NEW.category_id := v_matching_rule.id;  -- Temporarily store rule_id
      NEW.is_categorized := false;  -- Will be set by split function
    ELSE
      -- Apply simple category
      NEW.category_id := v_matching_rule.category_id;
      NEW.is_categorized := true;
      
      -- Update rule statistics
      UPDATE categorization_rules
      SET 
        apply_count = apply_count + 1,
        last_applied_at = now()
      WHERE id = v_matching_rule.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create AFTER trigger to handle split rules
CREATE OR REPLACE FUNCTION auto_apply_bank_split_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
BEGIN
  -- Check if this is a pending split rule application
  -- (category_id contains rule_id and is_categorized is false)
  IF NEW.category_id IS NOT NULL AND NEW.is_categorized = false AND NEW.is_split = false THEN
    -- Check if category_id actually points to a split rule
    SELECT is_split_rule, split_config INTO v_rule
    FROM categorization_rules
    WHERE id = NEW.category_id;
    
    IF v_rule.is_split_rule = true THEN
      -- Apply the split rule
      PERFORM apply_split_rule_to_bank_transaction(NEW.id, NEW.category_id, NEW.amount);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop old trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_auto_apply_bank_split_rules ON bank_transactions;
CREATE TRIGGER trigger_auto_apply_bank_split_rules
  AFTER INSERT ON bank_transactions
  FOR EACH ROW
  EXECUTE FUNCTION auto_apply_bank_split_rules();

-- Update the auto-apply trigger for POS sales to handle splits
CREATE OR REPLACE FUNCTION auto_apply_pos_categorization_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_matching_rule RECORD;
  v_sale_json JSONB;
BEGIN
  -- Skip if already categorized or split
  IF NEW.is_categorized = true OR NEW.is_split = true THEN
    RETURN NEW;
  END IF;
  
  -- Build sale JSON for matching
  v_sale_json := jsonb_build_object(
    'item_name', NEW.item_name,
    'total_price', NEW.total_price,
    'pos_category', NEW.pos_category
  );
  
  -- Find highest priority matching rule
  SELECT 
    cr.id,
    cr.is_split_rule,
    cr.category_id,
    cr.auto_apply
  INTO v_matching_rule
  FROM categorization_rules cr
  WHERE cr.restaurant_id = NEW.restaurant_id
    AND cr.is_active = true
    AND cr.auto_apply = true
    AND cr.applies_to IN ('pos_sales', 'both')
    AND matches_pos_sale_rule(cr.id, v_sale_json)
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
  
  -- Apply rule if found
  IF v_matching_rule.id IS NOT NULL THEN
    IF v_matching_rule.is_split_rule THEN
      -- Apply split rule after insert
      -- Store rule_id temporarily
      NEW.category_id := v_matching_rule.id;
      NEW.is_categorized := false;
    ELSE
      -- Apply simple category
      NEW.category_id := v_matching_rule.category_id;
      NEW.is_categorized := true;
      NEW.suggested_category_id := NULL;
      NEW.ai_confidence := NULL;
      NEW.ai_reasoning := NULL;
      
      -- Update rule statistics
      UPDATE categorization_rules
      SET 
        apply_count = apply_count + 1,
        last_applied_at = now()
      WHERE id = v_matching_rule.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create AFTER trigger to handle split rules for POS sales
CREATE OR REPLACE FUNCTION auto_apply_pos_split_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
BEGIN
  -- Check if this is a pending split rule application
  IF NEW.category_id IS NOT NULL AND NEW.is_categorized = false AND NEW.is_split = false THEN
    -- Check if category_id actually points to a split rule
    SELECT is_split_rule, split_config INTO v_rule
    FROM categorization_rules
    WHERE id = NEW.category_id;
    
    IF v_rule.is_split_rule = true THEN
      -- Apply the split rule
      PERFORM apply_split_rule_to_pos_sale(NEW.id, NEW.category_id, NEW.total_price);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop old trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_auto_apply_pos_split_rules ON unified_sales;
CREATE TRIGGER trigger_auto_apply_pos_split_rules
  AFTER INSERT ON unified_sales
  FOR EACH ROW
  EXECUTE FUNCTION auto_apply_pos_split_rules();

-- Update constraint on categorization_rules to allow NULL category_id for split rules
ALTER TABLE categorization_rules
  DROP CONSTRAINT IF EXISTS categorization_rules_category_id_fkey;

ALTER TABLE categorization_rules
  ADD CONSTRAINT categorization_rules_category_id_fkey 
  FOREIGN KEY (category_id) 
  REFERENCES chart_of_accounts(id) 
  ON DELETE CASCADE;

-- Add constraint to ensure category_id is provided for non-split rules
ALTER TABLE categorization_rules
  ADD CONSTRAINT check_category_for_non_split CHECK (
    (is_split_rule = true AND category_id IS NULL) OR
    (is_split_rule = false AND category_id IS NOT NULL)
  );

-- Update the at_least_one_pattern constraint to not include category_id
-- (It's now in check_category_for_non_split)
ALTER TABLE categorization_rules
  DROP CONSTRAINT IF EXISTS at_least_one_pattern;

ALTER TABLE categorization_rules
  ADD CONSTRAINT at_least_one_pattern CHECK (
    description_pattern IS NOT NULL OR
    amount_min IS NOT NULL OR
    amount_max IS NOT NULL OR
    supplier_id IS NOT NULL OR
    transaction_type IS NOT NULL OR
    pos_category IS NOT NULL OR
    item_name_pattern IS NOT NULL
  );
