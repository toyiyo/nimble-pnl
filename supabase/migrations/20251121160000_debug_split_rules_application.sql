-- Debug and fix split rules application issue
-- Check if there are any schema issues preventing rules from matching

-- First, let's see what columns actually exist
-- (This will show in logs when run)
DO $$
DECLARE
  col_exists BOOLEAN;
BEGIN
  -- Check if split_config column exists (shouldn't)
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'categorization_rules' 
    AND column_name = 'split_config'
  ) INTO col_exists;
  
  IF col_exists THEN
    RAISE NOTICE 'WARNING: Column split_config exists - this should be split_categories!';
    -- Drop the wrong column if it exists
    ALTER TABLE categorization_rules DROP COLUMN IF EXISTS split_config;
    RAISE NOTICE 'Dropped split_config column';
  END IF;
  
  -- Ensure split_categories column exists
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'categorization_rules' 
    AND column_name = 'split_categories'
  ) THEN
    RAISE NOTICE 'WARNING: Column split_categories does not exist - adding it';
    ALTER TABLE categorization_rules ADD COLUMN split_categories JSONB;
  END IF;
END $$;

-- Add debug logging to apply_rules_to_pos_sales function
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
  v_rule_count INTEGER;
BEGIN
  -- Check how many active rules exist for this restaurant
  SELECT COUNT(*) INTO v_rule_count
  FROM categorization_rules
  WHERE restaurant_id = p_restaurant_id
    AND is_active = true
    AND (applies_to = 'pos_sales' OR applies_to = 'both');
  
  RAISE NOTICE 'Found % active POS rules for restaurant %', v_rule_count, p_restaurant_id;
  
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
    
    -- Debug: Log the first few sales
    IF v_total_count <= 3 THEN
      RAISE NOTICE 'Checking sale %: item_name=%, total_price=%, pos_category=%', 
        v_sale.id, v_sale.item_name, v_sale.total_price, v_sale.pos_category;
    END IF;
    
    -- Find matching rule
    SELECT * INTO v_rule
    FROM find_matching_rules_for_pos_sale(p_restaurant_id, v_sale_json)
    LIMIT 1;
    
    -- Debug: Log if rule found
    IF v_rule.rule_id IS NOT NULL THEN
      RAISE NOTICE 'Found matching rule % for sale %', v_rule.rule_name, v_sale.id;
    ELSIF v_total_count <= 3 THEN
      RAISE NOTICE 'No matching rule found for sale %', v_sale.id;
    END IF;
    
    -- If rule found, categorize or split the sale
    IF v_rule.rule_id IS NOT NULL THEN
      BEGIN
        -- Check if this is a split rule
        IF v_rule.is_split_rule AND v_rule.split_categories IS NOT NULL THEN
          RAISE NOTICE 'Applying split rule % to sale %', v_rule.rule_name, v_sale.id;
          
          -- Apply split rule
          SELECT * INTO v_split_result
          FROM split_pos_sale(
            v_sale.id,
            v_rule.split_categories
          );
          
          -- Check if split was successful
          IF v_split_result.success THEN
            v_applied_count := v_applied_count + 1;
            RAISE NOTICE 'Successfully applied split rule to sale %', v_sale.id;
          ELSE
            RAISE NOTICE 'Failed to apply split rule to sale %: %', v_sale.id, v_split_result.message;
          END IF;
        ELSE
          RAISE NOTICE 'Applying regular rule % to sale %', v_rule.rule_name, v_sale.id;
          
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
  
  RAISE NOTICE 'Completed: applied % rules to % of % sales', v_applied_count, v_total_count, v_batch_limit;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales IS 
  'Applies categorization rules to uncategorized POS sales with debug logging. 
   Now supports split rules that automatically split sales across multiple categories.
   Processes up to p_batch_limit sales (default 100) to prevent timeouts.
   Check Supabase logs for debug output.';
