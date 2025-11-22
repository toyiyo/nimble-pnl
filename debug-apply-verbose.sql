-- Verbose debug version of apply_rules_to_pos_sales with detailed logging

CREATE OR REPLACE FUNCTION apply_rules_to_pos_sales_debug(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  sale_id UUID,
  item_name TEXT,
  rule_found BOOLEAN,
  rule_name TEXT,
  is_split_rule BOOLEAN,
  split_categories_raw JSONB,
  splits_converted JSONB,
  split_success BOOLEAN,
  split_message TEXT,
  error_detail TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_sale RECORD;
  v_rule RECORD;
  v_sale_json JSONB;
  v_split_result RECORD;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
  v_split JSONB;
  v_splits_with_amounts JSONB;
BEGIN
  FOR v_sale IN
    SELECT us.id, us.item_name, us.total_price, us.pos_category
    FROM unified_sales us
    WHERE us.restaurant_id = p_restaurant_id
      AND (us.is_categorized = false OR us.category_id IS NULL)
      AND us.is_split = false
    ORDER BY us.sale_date DESC
    LIMIT p_batch_limit
  LOOP
    BEGIN
      v_sale_json := jsonb_build_object(
        'item_name', v_sale.item_name,
        'total_price', v_sale.total_price,
        'pos_category', v_sale.pos_category
      );
      
      SELECT * INTO v_rule
      FROM find_matching_rules_for_pos_sale(p_restaurant_id, v_sale_json)
      LIMIT 1;
      
      IF v_rule.rule_id IS NULL THEN
        RETURN QUERY SELECT 
          v_sale.id,
          v_sale.item_name,
          false,
          NULL::TEXT,
          NULL::BOOLEAN,
          NULL::JSONB,
          NULL::JSONB,
          NULL::BOOLEAN,
          'No rule matched'::TEXT,
          NULL::TEXT;
        CONTINUE;
      END IF;
      
      IF v_rule.is_split_rule AND v_rule.split_categories IS NOT NULL THEN
        -- Convert percentage splits to amount splits
        v_splits_array := ARRAY[]::JSONB[];
        
        FOR v_split IN SELECT * FROM jsonb_array_elements(v_rule.split_categories)
        LOOP
          IF v_split->>'percentage' IS NOT NULL THEN
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', ROUND((v_sale.total_price * (v_split->>'percentage')::NUMERIC / 100.0), 2),
              'description', COALESCE(v_split->>'description', '')
            );
          ELSE
            v_splits_array := v_splits_array || jsonb_build_object(
              'category_id', v_split->>'category_id',
              'amount', (v_split->>'amount')::NUMERIC,
              'description', COALESCE(v_split->>'description', '')
            );
          END IF;
        END LOOP;
        
        v_splits_with_amounts := to_jsonb(v_splits_array);
        
        -- Try to split
        SELECT * INTO v_split_result
        FROM split_pos_sale(v_sale.id, v_splits_with_amounts);
        
        RETURN QUERY SELECT 
          v_sale.id,
          v_sale.item_name,
          true,
          v_rule.rule_name,
          true,
          v_rule.split_categories,
          v_splits_with_amounts,
          v_split_result.success,
          v_split_result.message,
          NULL::TEXT;
      ELSE
        RETURN QUERY SELECT 
          v_sale.id,
          v_sale.item_name,
          true,
          v_rule.rule_name,
          false,
          NULL::JSONB,
          NULL::JSONB,
          true,
          'Regular rule would apply'::TEXT,
          NULL::TEXT;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      RETURN QUERY SELECT 
        v_sale.id,
        v_sale.item_name,
        NULL::BOOLEAN,
        NULL::TEXT,
        NULL::BOOLEAN,
        NULL::JSONB,
        NULL::JSONB,
        false,
        'Exception occurred'::TEXT,
        SQLERRM;
    END;
  END LOOP;
END;
$$;

-- Run the debug version
SELECT * FROM apply_rules_to_pos_sales_debug(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5
);
