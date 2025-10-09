-- Fix cross-tenant mutation vulnerability in upsert_product_supplier
-- Add restaurant_id constraints to SELECT and UPDATE to prevent cross-tenant access

CREATE OR REPLACE FUNCTION public.upsert_product_supplier(
  p_restaurant_id uuid, 
  p_product_id uuid, 
  p_supplier_id uuid, 
  p_unit_cost numeric, 
  p_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
BEGIN
  -- CRITICAL SECURITY CHECK: Verify user has permission to modify this restaurant
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager', 'chef')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to modify this restaurant';
  END IF;

  -- Check if relationship exists (constrained by restaurant_id to prevent cross-tenant access)
  SELECT * INTO v_existing
  FROM product_suppliers
  WHERE product_id = p_product_id 
    AND supplier_id = p_supplier_id
    AND restaurant_id = p_restaurant_id;
  
  IF FOUND THEN
    -- Verify restaurant_id matches (additional safety check)
    IF v_existing.restaurant_id != p_restaurant_id THEN
      RAISE EXCEPTION 'Permission denied: cannot modify supplier relationship for different restaurant';
    END IF;
    
    -- Update existing relationship with new price data (constrained by restaurant_id)
    UPDATE product_suppliers
    SET 
      last_unit_cost = p_unit_cost,
      last_purchase_date = NOW(),
      last_purchase_quantity = p_quantity,
      purchase_count = purchase_count + 1,
      average_unit_cost = (
        (average_unit_cost * purchase_count + p_unit_cost) / 
        (purchase_count + 1)
      ),
      updated_at = NOW()
    WHERE product_id = p_product_id 
      AND supplier_id = p_supplier_id
      AND restaurant_id = p_restaurant_id;
  ELSE
    -- Create new relationship
    INSERT INTO product_suppliers (
      restaurant_id,
      product_id,
      supplier_id,
      last_unit_cost,
      last_purchase_date,
      last_purchase_quantity,
      average_unit_cost,
      purchase_count,
      is_preferred
    ) VALUES (
      p_restaurant_id,
      p_product_id,
      p_supplier_id,
      p_unit_cost,
      NOW(),
      p_quantity,
      p_unit_cost,
      1,
      -- Set as preferred if it's the first supplier for this product in this restaurant
      NOT EXISTS (
        SELECT 1 FROM product_suppliers 
        WHERE product_id = p_product_id
        AND restaurant_id = p_restaurant_id
      )
    );
  END IF;
END;
$$;