-- Update rule application functions to support split rules

-- Drop existing functions first to allow signature changes
DROP FUNCTION IF EXISTS find_matching_rules_for_bank_transaction(UUID, JSONB);
DROP FUNCTION IF EXISTS find_matching_rules_for_pos_sale(UUID, JSONB);

-- Update find_matching_rules functions to include split rule information
CREATE OR REPLACE FUNCTION find_matching_rules_for_bank_transaction(
  p_restaurant_id UUID,
  p_transaction JSONB
)
RETURNS TABLE (
  rule_id UUID,
  rule_name TEXT,
  category_id UUID,
  priority INTEGER,
  is_split_rule BOOLEAN,
  split_categories JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cr.id AS rule_id,
    cr.rule_name,
    cr.category_id,
    cr.priority,
    cr.is_split_rule,
    cr.split_categories
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'bank_transactions' OR cr.applies_to = 'both')
    -- Description pattern matching
    AND (
      cr.description_pattern IS NULL
      OR (
        CASE cr.description_match_type
          WHEN 'exact' THEN LOWER(p_transaction->>'description') = LOWER(cr.description_pattern)
          WHEN 'contains' THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern) || '%'
          WHEN 'starts_with' THEN LOWER(p_transaction->>'description') LIKE LOWER(cr.description_pattern) || '%'
          WHEN 'ends_with' THEN LOWER(p_transaction->>'description') LIKE '%' || LOWER(cr.description_pattern)
          WHEN 'regex' THEN (p_transaction->>'description') ~ cr.description_pattern
          ELSE false
        END
      )
    )
    -- Amount range matching
    AND (cr.amount_min IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) >= cr.amount_min)
    AND (cr.amount_max IS NULL OR ABS((p_transaction->>'amount')::NUMERIC) <= cr.amount_max)
    -- Supplier matching
    AND (cr.supplier_id IS NULL OR cr.supplier_id::TEXT = (p_transaction->>'supplier_id'))
    -- Transaction type matching
    AND (
      cr.transaction_type IS NULL
      OR cr.transaction_type = 'any'
      OR (cr.transaction_type = 'debit' AND (p_transaction->>'amount')::NUMERIC < 0)
      OR (cr.transaction_type = 'credit' AND (p_transaction->>'amount')::NUMERIC > 0)
    )
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION find_matching_rules_for_pos_sale(
  p_restaurant_id UUID,
  p_sale JSONB
)
RETURNS TABLE (
  rule_id UUID,
  rule_name TEXT,
  category_id UUID,
  priority INTEGER,
  is_split_rule BOOLEAN,
  split_categories JSONB
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    cr.id AS rule_id,
    cr.rule_name,
    cr.category_id,
    cr.priority,
    cr.is_split_rule,
    cr.split_categories
  FROM categorization_rules cr
  WHERE cr.restaurant_id = p_restaurant_id
    AND cr.is_active = true
    AND (cr.applies_to = 'pos_sales' OR cr.applies_to = 'both')
    -- Item name pattern matching
    AND (
      cr.item_name_pattern IS NULL
      OR (
        CASE cr.item_name_match_type
          WHEN 'exact' THEN LOWER(p_sale->>'item_name') = LOWER(cr.item_name_pattern)
          WHEN 'contains' THEN LOWER(p_sale->>'item_name') LIKE '%' || LOWER(cr.item_name_pattern) || '%'
          WHEN 'starts_with' THEN LOWER(p_sale->>'item_name') LIKE LOWER(cr.item_name_pattern) || '%'
          WHEN 'ends_with' THEN LOWER(p_sale->>'item_name') LIKE '%' || LOWER(cr.item_name_pattern)
          WHEN 'regex' THEN (p_sale->>'item_name') ~ cr.item_name_pattern
          ELSE false
        END
      )
    )
    -- POS category matching
    AND (cr.pos_category IS NULL OR LOWER(p_sale->>'pos_category') = LOWER(cr.pos_category))
    -- Amount range matching
    AND (cr.amount_min IS NULL OR (p_sale->>'total_price')::NUMERIC >= cr.amount_min)
    AND (cr.amount_max IS NULL OR (p_sale->>'total_price')::NUMERIC <= cr.amount_max)
  ORDER BY cr.priority DESC, cr.created_at ASC
  LIMIT 1;
END;
$$;

-- Update apply_rules_to_bank_transactions to handle split rules
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transaction RECORD;
  v_rule RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_transaction_json JSONB;
  v_batch_count INTEGER := 0;
  v_split_result RECORD;
BEGIN
  -- Get uncategorized bank transactions (limited to prevent timeout)
  FOR v_transaction IN
    SELECT id, description, amount, supplier_id
    FROM bank_transactions
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
      AND is_split = false  -- Don't re-apply to already split transactions
    ORDER BY transaction_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;
    v_batch_count := v_batch_count + 1;
    
    -- Build transaction JSONB for matching
    v_transaction_json := jsonb_build_object(
      'description', v_transaction.description,
      'amount', v_transaction.amount,
      'supplier_id', v_transaction.supplier_id
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_bank_transaction(p_restaurant_id, v_transaction_json)
    LIMIT 1;
    
    -- If rule found, categorize or split the transaction
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        -- Check if this is a split rule
        IF v_rule.is_split_rule AND v_rule.split_categories IS NOT NULL THEN
          -- Apply split rule
          SELECT * INTO v_split_result
          FROM split_bank_transaction(
            v_transaction.id,
            v_rule.split_categories
          );
          
          -- Check if split was successful (split_bank_transaction returns JSONB)
          IF v_split_result IS NOT NULL THEN
            v_applied_count := v_applied_count + 1;
          END IF;
        ELSE
          -- Apply regular categorization
          PERFORM categorize_bank_transaction(
            v_transaction.id,
            v_rule.category_id,
            'Auto-categorized by rule: ' || v_rule.rule_name,
            NULL,
            v_transaction.supplier_id
          );
          v_applied_count := v_applied_count + 1;
        END IF;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing transaction %: %', v_transaction.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Update apply_rules_to_pos_sales to handle split rules
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  applied_count INTEGER,
  total_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_rule RECORD;
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_sale_json JSONB;
  v_batch_count INTEGER := 0;
  v_split_result RECORD;
BEGIN
  -- Get uncategorized POS sales (limited to prevent timeout)
  FOR v_sale IN
    SELECT id, item_name, total_price, pos_category
    FROM unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
      AND is_split = false  -- Don't re-apply to already split sales
    ORDER BY sale_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;
    v_batch_count := v_batch_count + 1;
    
    -- Build sale JSONB for matching
    v_sale_json := jsonb_build_object(
      'item_name', v_sale.item_name,
      'total_price', v_sale.total_price,
      'pos_category', v_sale.pos_category
    );
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(p_restaurant_id, v_sale_json)
    LIMIT 1;
    
    -- If rule found, categorize or split the sale
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        -- Check if this is a split rule
        IF v_rule.is_split_rule AND v_rule.split_categories IS NOT NULL THEN
          -- Apply split rule
          SELECT * INTO v_split_result
          FROM split_pos_sale(
            v_sale.id,
            v_rule.split_categories
          );
          
          -- Check if split was successful
          IF v_split_result.success THEN
            v_applied_count := v_applied_count + 1;
          END IF;
        ELSE
          -- Apply regular categorization
          UPDATE unified_sales
          SET 
            category_id = v_rule.category_id,
            is_categorized = true,
            updated_at = now()
          WHERE id = v_sale.id;
          v_applied_count := v_applied_count + 1;
        END IF;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Add comment explaining the changes
COMMENT ON FUNCTION apply_rules_to_bank_transactions IS 
  'Applies categorization rules to uncategorized bank transactions. 
   Now supports split rules that automatically split transactions across multiple categories.
   Processes up to p_batch_limit transactions (default 100) to prevent timeouts.
   Call multiple times if needed to process all transactions.';

COMMENT ON FUNCTION apply_rules_to_pos_sales IS 
  'Applies categorization rules to uncategorized POS sales. 
   Now supports split rules that automatically split sales across multiple categories.
   Processes up to p_batch_limit sales (default 100) to prevent timeouts.
   Call multiple times if needed to process all sales.';
