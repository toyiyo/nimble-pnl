-- Fix apply_rules_to_pos_sales to convert percentages to amounts before splitting

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
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
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
          -- Convert percentage splits to amount splits
          v_splits_array := ARRAY[]::JSONB[];
          
          FOR v_split IN SELECT * FROM jsonb_array_elements(v_rule.split_categories)
          LOOP
            -- Calculate amount from percentage or use direct amount
            IF v_split->>'percentage' IS NOT NULL THEN
              -- Convert percentage to amount
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2),
                'description', COALESCE(v_split->>'description', '')
              );
            ELSE
              -- Use amount directly
              v_splits_array := v_splits_array || jsonb_build_object(
                'category_id', v_split->>'category_id',
                'amount', (v_split->>'amount')::NUMERIC,
                'description', COALESCE(v_split->>'description', '')
              );
            END IF;
          END LOOP;
          
          -- Convert array to JSONB
          v_splits_with_amounts := to_jsonb(v_splits_array);
          
          -- Apply split rule
          SELECT * INTO v_split_result
          FROM split_pos_sale(
            v_sale.id,
            v_splits_with_amounts
          );
          
          -- Check if split was successful
          IF v_split_result.success THEN
            v_applied_count := v_applied_count + 1;
          ELSE
            RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
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

COMMENT ON FUNCTION apply_rules_to_pos_sales IS 
  'Applies categorization rules to uncategorized POS sales. 
   Now supports split rules that automatically split sales across multiple categories.
   Converts percentage-based splits to amount-based splits before applying.
   Processes up to p_batch_limit sales (default 100) to prevent timeouts.
   Call multiple times if needed to process all sales.';
