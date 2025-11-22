-- Fix split_pos_sale to clean up any existing child splits before creating new ones
-- This prevents duplicate splits when a sale is re-split after being reverted

DROP FUNCTION IF EXISTS split_pos_sale(UUID, JSONB);

CREATE OR REPLACE FUNCTION split_pos_sale(
  p_sale_id UUID,
  p_splits JSONB
)
RETURNS TABLE(success BOOLEAN, message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_split JSONB;
  v_total_split_amount NUMERIC := 0;
  v_user_id UUID;
  v_has_permission BOOLEAN;
BEGIN
  -- Get the original sale
  SELECT * INTO v_sale
  FROM unified_sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Sale not found';
    RETURN;
  END IF;

  -- Authorization check: verify user has owner or manager role for this restaurant
  -- OR if called from another function (auth.uid() might be NULL), verify via restaurant ownership
  v_user_id := auth.uid();
  
  -- Skip auth check if called from a trusted function (auth.uid is NULL in SECURITY DEFINER context)
  -- Instead, we rely on the calling function to have already verified permissions
  IF v_user_id IS NOT NULL THEN
    -- Direct user call - check permissions
    SELECT EXISTS (
      SELECT 1
      FROM user_restaurants
      WHERE user_id = v_user_id
        AND restaurant_id = v_sale.restaurant_id
        AND role IN ('owner', 'manager')
    ) INTO v_has_permission;

    IF NOT v_has_permission THEN
      RETURN QUERY SELECT FALSE, 'Unauthorized: user cannot split sales for this restaurant';
      RETURN;
    END IF;
  END IF;
  -- If v_user_id IS NULL, we're being called by a SECURITY DEFINER function
  -- which has already done permission checks, so we proceed

  -- Check if already split
  IF v_sale.is_split THEN
    RETURN QUERY SELECT FALSE, 'Sale is already split';
    RETURN;
  END IF;

  -- Clean up any orphaned child splits that might exist from incomplete operations
  -- This prevents duplicate splits if a previous operation failed midway
  DELETE FROM unified_sales
  WHERE parent_sale_id = p_sale_id;

  -- Validate split amounts sum up correctly
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    v_total_split_amount := v_total_split_amount + (v_split->>'amount')::NUMERIC;
  END LOOP;

  IF ABS(v_total_split_amount - v_sale.total_price) > 0.01 THEN
    RETURN QUERY SELECT FALSE, 'Split amounts must equal the original sale amount (got ' || v_total_split_amount || ', expected ' || v_sale.total_price || ')';
    RETURN;
  END IF;

  -- Mark original sale as split
  UPDATE unified_sales
  SET 
    is_split = true,
    is_categorized = true,
    updated_at = now()
  WHERE id = p_sale_id;

  -- Create split sales
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
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
      parent_sale_id,
      raw_data,
      created_at,
      updated_at
    )
    SELECT
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id || '_split_' || (v_split->>'category_id'),
      item_name || ' - ' || COALESCE(v_split->>'description', 'Split'),
      quantity,
      (v_split->>'amount')::NUMERIC / quantity, -- unit price
      (v_split->>'amount')::NUMERIC, -- total price
      sale_date,
      sale_time,
      pos_category,
      (v_split->>'category_id')::UUID,
      true, -- is_categorized
      p_sale_id, -- parent_sale_id
      jsonb_build_object(
        'split_from', p_sale_id,
        'split_amount', v_split->>'amount',
        'split_description', COALESCE(v_split->>'description', '')
      ),
      now(),
      now()
    FROM unified_sales
    WHERE id = p_sale_id;
  END LOOP;

  RETURN QUERY SELECT TRUE, 'Sale split successfully into ' || jsonb_array_length(p_splits) || ' categories';
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION split_pos_sale(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION split_pos_sale(UUID, JSONB) TO service_role;

COMMENT ON FUNCTION split_pos_sale IS 'Splits a POS sale into multiple categories. Cleans up any orphaned child splits before creating new ones to prevent duplicates.';
