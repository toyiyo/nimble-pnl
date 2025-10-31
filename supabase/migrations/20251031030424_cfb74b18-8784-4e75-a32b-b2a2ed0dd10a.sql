-- Add authorization check to split_pos_sale function
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
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Not authenticated';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM user_restaurants
    WHERE user_id = v_user_id
      AND restaurant_id = v_sale.restaurant_id
      AND role IN ('owner', 'manager')
  ) INTO v_has_permission;

  IF NOT v_has_permission THEN
    RETURN QUERY SELECT FALSE, 'Not authorized to split this sale';
    RETURN;
  END IF;

  -- Check if already split
  IF v_sale.is_split THEN
    RETURN QUERY SELECT FALSE, 'Sale is already split';
    RETURN;
  END IF;

  -- Validate split amounts sum up correctly
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    v_total_split_amount := v_total_split_amount + (v_split->>'amount')::NUMERIC;
  END LOOP;

  IF ABS(v_total_split_amount - v_sale.total_price) > 0.01 THEN
    RETURN QUERY SELECT FALSE, 'Split amounts must equal the original sale amount';
    RETURN;
  END IF;

  -- Mark the original sale as split
  UPDATE unified_sales
  SET is_split = TRUE
  WHERE id = p_sale_id;

  -- Create split entries (no ON CONFLICT needed - new entries)
  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    INSERT INTO unified_sales (
      restaurant_id,
      pos_system,
      external_order_id,
      external_item_id,
      item_name,
      quantity,
      total_price,
      sale_date,
      sale_time,
      category_id,
      is_categorized,
      parent_sale_id,
      is_split,
      synced_at
    ) VALUES (
      v_sale.restaurant_id,
      v_sale.pos_system,
      v_sale.external_order_id,
      v_sale.external_item_id,
      COALESCE((v_split->>'description')::TEXT, v_sale.item_name || ' (split)'),
      1,
      (v_split->>'amount')::NUMERIC,
      v_sale.sale_date,
      v_sale.sale_time,
      (v_split->>'category_id')::UUID,
      TRUE,
      p_sale_id,
      FALSE,
      NOW()
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, 'Sale split successfully';
END;
$$;