-- Fix NULL handling and validation issues in categorize_pos_sale and split_pos_sale

-- 1. Fix categorize_pos_sale to validate category_id exists
DROP FUNCTION IF EXISTS categorize_pos_sale(UUID, UUID);

CREATE FUNCTION categorize_pos_sale(
  p_sale_id UUID,
  p_category_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id UUID;
BEGIN
  -- Verify user has access to this sale's restaurant
  SELECT restaurant_id INTO v_restaurant_id
  FROM unified_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Check user authorization
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = v_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: User does not have permission to categorize sales for this restaurant';
  END IF;

  -- Validate category exists in chart of accounts for this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM chart_of_accounts
    WHERE id = p_category_id
    AND restaurant_id = v_restaurant_id
    AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Invalid category: Category does not exist or is not active for this restaurant';
  END IF;

  -- Update the sale with the new category
  UPDATE unified_sales
  SET 
    category_id = p_category_id,
    is_categorized = true,
    suggested_category_id = NULL,
    ai_confidence = NULL,
    ai_reasoning = NULL,
    updated_at = now()
  WHERE id = p_sale_id;
END;
$$;

COMMENT ON FUNCTION categorize_pos_sale(UUID, UUID) IS 
'Categorizes a POS sale. Validates category exists in chart of accounts before updating. Uses SECURITY DEFINER to bypass RLS for updates, but includes explicit authorization checks to ensure only owners/managers can categorize sales for their restaurants.';

-- 2. Fix split_pos_sale NULL handling in GREATEST and division by zero
DROP FUNCTION IF EXISTS split_pos_sale(UUID, JSONB);

CREATE FUNCTION split_pos_sale(
  p_sale_id UUID,
  p_splits JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_record unified_sales%ROWTYPE;
  v_total_split_amount NUMERIC := 0;
  v_split JSONB;
  v_restaurant_id UUID;
BEGIN
  -- Get the sale record
  SELECT * INTO v_sale_record
  FROM unified_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;

  -- Verify user has access to this sale's restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = v_sale_record.restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: User does not have permission to split sales for this restaurant';
  END IF;

  -- Validate split structure
  IF NOT (p_splits IS NOT NULL AND jsonb_typeof(p_splits) = 'array') THEN
    RAISE EXCEPTION 'Invalid splits: must be a non-empty JSON array';
  END IF;

  -- Validate array is not empty
  IF jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION 'Invalid splits: array cannot be empty';
  END IF;

  -- Validate each split has required fields and correct data types
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    -- Check required fields exist
    IF NOT (v_split ? 'amount' AND v_split ? 'category_id' AND v_split ? 'description') THEN
      RAISE EXCEPTION 'Invalid split: missing required fields (amount, category_id, description)';
    END IF;

    -- Validate amount is numeric (handles decimal numbers, negative numbers)
    IF NOT (v_split->>'amount' ~ '^[+-]?\d+(\.\d+)?$') THEN
      RAISE EXCEPTION 'Invalid split: amount must be numeric, got: %', v_split->>'amount';
    END IF;

    -- Validate category_id is a valid UUID and exists in chart of accounts
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM chart_of_accounts
        WHERE id = (v_split->>'category_id')::UUID
        AND restaurant_id = v_sale_record.restaurant_id
        AND is_active = true
      ) THEN
        RAISE EXCEPTION 'Invalid split: category does not exist or is not active, category_id: %', v_split->>'category_id';
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid split: category_id must be a valid UUID, got: %', v_split->>'category_id';
    END;
  END LOOP;

  -- Calculate total split amount (now safe to cast)
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    v_total_split_amount := v_total_split_amount + (v_split->>'amount')::NUMERIC;
  END LOOP;

  -- Validate that splits equal total_price
  -- Use 0.5% tolerance or 0.01, whichever is larger
  -- This handles zero-decimal currencies (JPY, KRW) and three-decimal currencies (BHD, KWD)
  -- FIX: Handle NULL total_price by using COALESCE
  IF ABS(v_total_split_amount - COALESCE(v_sale_record.total_price, 0)) > GREATEST(0.01, COALESCE(v_sale_record.total_price, 0) * 0.005) THEN
    RAISE EXCEPTION 'Split amounts must equal total sale price. Expected: %, Got: %', 
      COALESCE(v_sale_record.total_price, 0), v_total_split_amount;
  END IF;

  -- Mark the original sale as split
  UPDATE unified_sales
  SET 
    is_split = true,
    updated_at = now()
  WHERE id = p_sale_id;

  -- Insert split records (now safe from casting errors)
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    INSERT INTO unified_sales (
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id,
      item_name,
      quantity,
      unit_price,
      total_price,
      sale_date,
      sale_time,
      pos_category,
      category_id,
      is_categorized,
      raw_data,
      parent_sale_id
    )
    VALUES (
      v_sale_record.restaurant_id,
      v_sale_record.pos_system,
      v_sale_record.external_order_id,
      v_sale_record.external_item_id,
      (v_split->>'description')::TEXT,
      v_sale_record.quantity,
      -- FIX: Handle division by zero - preserve original unit_price if quantity is 0
      CASE 
        WHEN COALESCE(v_sale_record.quantity, 0) > 0 
        THEN (v_split->>'amount')::NUMERIC / v_sale_record.quantity
        ELSE COALESCE(v_sale_record.unit_price, 0)
      END,
      (v_split->>'amount')::NUMERIC,
      v_sale_record.sale_date,
      v_sale_record.sale_time,
      v_sale_record.pos_category,
      (v_split->>'category_id')::UUID,
      true,
      v_sale_record.raw_data,
      p_sale_id
    );
  END LOOP;
END;
$$;

COMMENT ON FUNCTION split_pos_sale(UUID, JSONB) IS 
'Splits a POS sale into multiple line items with different categories. Validates JSONB structure, data types, and category existence before processing. Handles NULL values in total_price and zero quantities. Uses SECURITY DEFINER to bypass RLS for updates, but includes explicit authorization checks to ensure only owners/managers can split sales for their restaurants. Uses adaptive tolerance for different currency decimal places.';