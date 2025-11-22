-- Debug version to test bank transaction split rule matching and conversion

CREATE OR REPLACE FUNCTION apply_rules_to_bank_transactions_debug(
  p_restaurant_id UUID,
  p_batch_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  transaction_id UUID,
  description TEXT,
  amount NUMERIC,
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
  v_transaction RECORD;
  v_rule RECORD;
  v_transaction_json JSONB;
  v_split_result JSONB;
  v_splits_array JSONB[] := ARRAY[]::JSONB[];
  v_split JSONB;
  v_splits_with_amounts JSONB;
BEGIN
  FOR v_transaction IN
    SELECT bt.id, bt.description, bt.amount, bt.supplier_id
    FROM bank_transactions bt
    WHERE bt.restaurant_id = p_restaurant_id
      AND (bt.is_categorized = false OR bt.category_id IS NULL)
      AND bt.is_split = false
      AND bt.excluded_reason IS NULL
    ORDER BY bt.transaction_date DESC
    LIMIT p_batch_limit
  LOOP
    BEGIN
      v_transaction_json := jsonb_build_object(
        'description', v_transaction.description,
        'amount', v_transaction.amount,
        'supplier_id', v_transaction.supplier_id
      );
      
      SELECT * INTO v_rule
      FROM find_matching_rules_for_bank_transaction(p_restaurant_id, v_transaction_json)
      LIMIT 1;
      
      IF v_rule.rule_id IS NULL THEN
        RETURN QUERY SELECT 
          v_transaction.id,
          v_transaction.description,
          v_transaction.amount,
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
        
        -- Try to split
        SELECT split_bank_transaction(v_transaction.id, v_splits_with_amounts) INTO v_split_result;
        
        RETURN QUERY SELECT 
          v_transaction.id,
          v_transaction.description,
          v_transaction.amount,
          true,
          v_rule.rule_name,
          true,
          v_rule.split_categories,
          v_splits_with_amounts,
          (v_split_result->>'success')::BOOLEAN,
          v_split_result->>'message',
          NULL::TEXT;
      ELSE
        RETURN QUERY SELECT 
          v_transaction.id,
          v_transaction.description,
          v_transaction.amount,
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
        v_transaction.id,
        v_transaction.description,
        v_transaction.amount,
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

-- Test with Tracer transactions
SELECT * FROM apply_rules_to_bank_transactions_debug(
  'b80c60f4-76f9-49e6-9e63-7594d708d31a'::UUID,
  5
);

-- Check if transactions have "Tracer" in description
SELECT 
  id,
  transaction_date,
  description,
  amount,
  is_categorized,
  excluded_reason,
  is_split
FROM bank_transactions
WHERE restaurant_id = 'b80c60f4-76f9-49e6-9e63-7594d708d31a'
  AND description ILIKE '%tracer%'
  AND (is_categorized = false OR category_id IS NULL)
  AND is_split = false
  AND excluded_reason IS NULL
ORDER BY transaction_date DESC
LIMIT 10;
