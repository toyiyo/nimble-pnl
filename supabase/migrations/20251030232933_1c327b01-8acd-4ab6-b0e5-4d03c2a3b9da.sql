-- Fix SECURITY DEFINER function to include proper authorization checks
-- This prevents unauthorized users from categorizing sales for restaurants they don't have access to

CREATE OR REPLACE FUNCTION categorize_pos_sale(
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

-- Add comment explaining the security model
COMMENT ON FUNCTION categorize_pos_sale(UUID, UUID) IS 
'Categorizes a POS sale. Uses SECURITY DEFINER to bypass RLS for updates, but includes explicit authorization checks to ensure only owners/managers can categorize sales for their restaurants.';