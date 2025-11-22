-- Fix apply_rules_to_bank_transactions to convert percentage splits to amount splits
-- Same issue as POS sales: rules store percentages, but split_bank_transaction expects amounts

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
  v_split_result JSONB;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- Get uncategorized bank transactions (limited to prevent timeout)
  FOR v_transaction IN
    SELECT id, description, amount, supplier_id
    FROM bank_transactions
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
      AND is_split = false  -- Don't re-apply to already split transactions
      AND excluded_reason IS NULL  -- Don't apply to excluded transactions
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
          -- Convert percentage splits to amount splits
          v_splits_array := ARRAY[]::JSONB[];
          
          FOR v_split IN SELECT * FROM jsonb_array_elements(v_rule.split_categories)
          LOOP
            -- Check if this is a percentage split or amount split
            IF v_split->>'percentage' IS NOT NULL THEN
              -- Convert percentage to amount based on transaction amount
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', ROUND((ABS(v_transaction.amount) * (v_split->>'percentage')::NUMERIC / 100.0), 2),
                'description', COALESCE(v_split->>'description', '')
              );
            ELSE
              -- Already has amount, use as-is
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', (v_split->>'amount')::NUMERIC,
                'description', COALESCE(v_split->>'description', '')
              );
            END IF;
          END LOOP;
          
          -- Convert array to JSONB
          v_splits_with_amounts := to_jsonb(v_splits_array);
          
          -- Apply split rule with converted amounts
          SELECT split_bank_transaction(
            v_transaction.id,
            v_splits_with_amounts
          ) INTO v_split_result;
          
          -- Check if split was successful
          IF v_split_result->>'success' = 'true' THEN
            v_applied_count := v_applied_count + 1;
          ELSE
            RAISE NOTICE 'Failed to split transaction %: %', v_transaction.id, v_split_result->>'message';
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

COMMENT ON FUNCTION apply_rules_to_bank_transactions IS 
  'Applies categorization rules to uncategorized bank transactions. Converts percentage-based split rules to amount-based splits before calling split_bank_transaction.';
