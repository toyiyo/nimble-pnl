-- Add authentication checks to apply_rules functions to allow direct RPC calls from frontend
-- This removes the dependency on Edge Functions which have execution limits

-- Update apply_rules_to_pos_sales to include permission check
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
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_split_result RECORD;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- CRITICAL SECURITY CHECK: Verify user has permission to apply rules for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  -- Only fetch uncategorized POS sales that already have a matching rule
  FOR v_sale IN
    SELECT
      s.id,
      s.total_price,
      matched.rule_id,
      matched.rule_name,
      matched.category_id AS rule_category_id,
      matched.is_split_rule,
      matched.split_categories
    FROM unified_sales s
    CROSS JOIN LATERAL find_matching_rules_for_pos_sale(
      p_restaurant_id,
      jsonb_build_object(
        'item_name', s.item_name,
        'total_price', s.total_price,
        'pos_category', s.pos_category
      )
    ) matched
    WHERE s.restaurant_id = p_restaurant_id
      AND (s.is_categorized = false OR s.category_id IS NULL)
      AND s.is_split = false
      AND matched.rule_id IS NOT NULL
    ORDER BY s.sale_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;

    -- Apply split rule or standard categorization
    IF v_sale.is_split_rule AND v_sale.split_categories IS NOT NULL THEN
      v_splits_array := ARRAY[]::JSONB[];

      FOR v_split IN SELECT * FROM jsonb_array_elements(v_sale.split_categories)
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

      SELECT * INTO v_split_result
      FROM split_pos_sale(
        v_sale.id,
        v_splits_with_amounts
      );

      IF v_split_result.success THEN
        v_applied_count := v_applied_count + 1;
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_sale.rule_id;
      ELSE
        RAISE NOTICE 'Failed to split sale %: %', v_sale.id, v_split_result.message;
      END IF;
    ELSE
      UPDATE unified_sales
      SET 
        category_id = v_sale.rule_category_id,
        is_categorized = true,
        updated_at = now()
      WHERE id = v_sale.id;
      v_applied_count := v_applied_count + 1;
      UPDATE categorization_rules
      SET 
        apply_count = apply_count + 1,
        last_applied_at = now()
      WHERE id = v_sale.rule_id;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_pos_sales IS 
  'Applies categorization rules to uncategorized POS sales. Includes permission check for owner/manager. Only batches sales that already match a rule, supports split rules with percentage-to-amount conversion, and processes up to p_batch_limit to avoid timeouts.';


-- Update apply_rules_to_bank_transactions to include permission check
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
  v_applied_count INTEGER := 0;
  v_total_count INTEGER := 0;
  v_split_result JSONB;
  v_splits_with_amounts JSONB;
  v_split JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
BEGIN
  -- CRITICAL SECURITY CHECK: Verify user has permission to apply rules for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to apply rules for this restaurant';
  END IF;

  -- Only fetch uncategorized bank transactions that already have a matching rule
  FOR v_transaction IN
    SELECT
      bt.id,
      bt.amount,
      bt.supplier_id,
      matched.rule_id,
      matched.rule_name,
      matched.category_id AS rule_category_id,
      matched.is_split_rule,
      matched.split_categories
    FROM bank_transactions bt
    CROSS JOIN LATERAL find_matching_rules_for_bank_transaction(
      p_restaurant_id,
      jsonb_build_object(
        'description', bt.description,
        'amount', bt.amount,
        'supplier_id', bt.supplier_id
      )
    ) matched
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
      AND matched.rule_id IS NOT NULL
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
  LOOP
    v_total_count := v_total_count + 1;

    IF v_transaction.is_split_rule AND v_transaction.split_categories IS NOT NULL THEN
      v_splits_array := ARRAY[]::JSONB[];

      FOR v_split IN SELECT * FROM jsonb_array_elements(v_transaction.split_categories)
      LOOP
        IF v_split->>'percentage' IS NOT NULL THEN
          v_splits_array := v_splits_array || jsonb_build_object(
            'category_id', v_split->>'category_id',
            'amount', ROUND((ABS(v_transaction.amount) * (v_split->>'percentage')::NUMERIC / 100.0), 2),
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

      SELECT split_bank_transaction(
        v_transaction.id,
        v_splits_with_amounts
      ) INTO v_split_result;

      IF v_split_result->>'success' = 'true' THEN
        v_applied_count := v_applied_count + 1;
        UPDATE categorization_rules
        SET 
          apply_count = apply_count + 1,
          last_applied_at = now()
        WHERE id = v_transaction.rule_id;
      ELSE
        RAISE NOTICE 'Failed to split transaction %: %', v_transaction.id, v_split_result->>'message';
      END IF;
    ELSE
      PERFORM categorize_bank_transaction(
        v_transaction.id,
        v_transaction.rule_category_id,
        'Auto-categorized by rule: ' || v_transaction.rule_name,
        NULL,
        v_transaction.supplier_id
      );
      v_applied_count := v_applied_count + 1;
      UPDATE categorization_rules
      SET 
        apply_count = apply_count + 1,
        last_applied_at = now()
      WHERE id = v_transaction.rule_id;
    END IF;
  END LOOP;
  
  RETURN QUERY SELECT v_applied_count, v_total_count;
END;
$$;

COMMENT ON FUNCTION apply_rules_to_bank_transactions IS 
  'Applies categorization rules to uncategorized bank transactions. Includes permission check for owner/manager. Batches only transactions that already match a rule, supports split rules with percentage-to-amount conversion, and processes up to p_batch_limit to avoid timeouts.';
