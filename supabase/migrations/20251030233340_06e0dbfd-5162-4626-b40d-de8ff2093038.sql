-- Fix split_pos_sale SECURITY DEFINER function to include authorization checks
-- and improve currency handling for different decimal place currencies

CREATE OR REPLACE FUNCTION split_pos_sale(
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

  -- Calculate total split amount
  FOR v_split IN SELECT jsonb_array_elements(p_splits)
  LOOP
    v_total_split_amount := v_total_split_amount + (v_split->>'amount')::NUMERIC;
  END LOOP;

  -- Validate that splits equal total_price
  -- Use 0.5% tolerance or 0.01, whichever is larger
  -- This handles zero-decimal currencies (JPY, KRW) and three-decimal currencies (BHD, KWD)
  IF ABS(v_total_split_amount - COALESCE(v_sale_record.total_price, 0)) > GREATEST(0.01, v_sale_record.total_price * 0.005) THEN
    RAISE EXCEPTION 'Split amounts must equal total sale price. Expected: %, Got: %', 
      COALESCE(v_sale_record.total_price, 0), v_total_split_amount;
  END IF;

  -- Mark the original sale as split
  UPDATE unified_sales
  SET 
    is_split = true,
    updated_at = now()
  WHERE id = p_sale_id;

  -- Insert split records
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
      (v_split->>'amount')::NUMERIC / NULLIF(v_sale_record.quantity, 0),
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

-- Add comment explaining the security model
COMMENT ON FUNCTION split_pos_sale(UUID, JSONB) IS 
'Splits a POS sale into multiple line items with different categories. Uses SECURITY DEFINER to bypass RLS for updates, but includes explicit authorization checks to ensure only owners/managers can split sales for their restaurants. Uses adaptive tolerance for different currency decimal places.';