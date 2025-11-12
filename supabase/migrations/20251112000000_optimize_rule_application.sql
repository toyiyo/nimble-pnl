-- Optimize categorization rule application to prevent timeouts
-- This migration adds batch processing and limits to the rule application functions

-- Drop existing functions to avoid overload ambiguity
DROP FUNCTION IF EXISTS apply_rules_to_bank_transactions(uuid);
DROP FUNCTION IF EXISTS apply_rules_to_pos_sales(uuid);

-- Create the apply_rules_to_bank_transactions function with batch limit optimization
CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 1000
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
BEGIN
  -- Get uncategorized bank transactions (limited to prevent timeout)
  FOR v_transaction IN
    SELECT id, description, amount, supplier_id
    FROM bank_transactions
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
    ORDER BY transaction_date DESC  -- Process recent transactions first
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
    
    -- If rule found, categorize the transaction
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        PERFORM categorize_bank_transaction(
          v_transaction.id,
          v_rule.category_id,
          'Auto-categorized by rule: ' || v_rule.rule_name,
          NULL,
          v_transaction.supplier_id
        );
        
        -- Update rule statistics (batch updates would be better, but this is simpler)
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
        v_applied_count := v_applied_count + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing transaction %: %', v_transaction.id, SQLERRM;
      END;
    END IF;
    
    -- Commit every 100 transactions to avoid long-running transaction issues
    IF v_batch_count % 100 = 0 THEN
      -- Note: We can't actually COMMIT in a function, but this comment documents the intent
      -- In practice, the client should call this function multiple times if needed
      NULL;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Create the apply_rules_to_pos_sales function with batch limit optimization
CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 1000
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
BEGIN
  -- Get uncategorized POS sales (limited to prevent timeout)
  FOR v_sale IN
    SELECT id, item_name, total_price, pos_category
    FROM unified_sales
    WHERE restaurant_id = p_restaurant_id
      AND (is_categorized = false OR category_id IS NULL)
    ORDER BY sale_date DESC  -- Process recent sales first
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
    
    -- If rule found, categorize the sale
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        UPDATE unified_sales
        SET 
          category_id = v_rule.category_id,
          is_categorized = true,
          updated_at = now()
        WHERE id = v_sale.id;
        
        -- Update rule statistics
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_rule.rule_id;
        
        v_applied_count := v_applied_count + 1;
      EXCEPTION WHEN OTHERS THEN
        -- Log error but continue processing
        RAISE NOTICE 'Error categorizing sale %: %', v_sale.id, SQLERRM;
      END;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

-- Add comment explaining the batch limit
COMMENT ON FUNCTION apply_rules_to_bank_transactions IS 
  'Applies categorization rules to uncategorized bank transactions. 
   Processes up to p_batch_limit transactions (default 1000) to prevent timeouts.
   Call multiple times if needed to process all transactions.';

COMMENT ON FUNCTION apply_rules_to_pos_sales IS 
  'Applies categorization rules to uncategorized POS sales. 
   Processes up to p_batch_limit sales (default 1000) to prevent timeouts.
   Call multiple times if needed to process all sales.';
