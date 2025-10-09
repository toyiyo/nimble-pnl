-- Fix race condition in preferred supplier update
-- Create atomic function to handle preferred supplier updates

CREATE OR REPLACE FUNCTION public.set_preferred_product_supplier(
  p_product_supplier_id uuid,
  p_product_id uuid,
  p_restaurant_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify user has permission
  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE restaurant_id = p_restaurant_id
    AND user_id = auth.uid()
    AND role IN ('owner', 'manager', 'chef')
  ) THEN
    RAISE EXCEPTION 'Permission denied: user does not have access to modify this restaurant';
  END IF;

  -- Verify the product_supplier exists and belongs to this restaurant/product
  IF NOT EXISTS (
    SELECT 1 FROM product_suppliers
    WHERE id = p_product_supplier_id
    AND product_id = p_product_id
    AND restaurant_id = p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'Product supplier not found or does not belong to this restaurant/product';
  END IF;

  -- Atomically update: set is_preferred to true for the target, false for all others
  UPDATE product_suppliers
  SET 
    is_preferred = (id = p_product_supplier_id),
    updated_at = NOW()
  WHERE product_id = p_product_id
  AND restaurant_id = p_restaurant_id;
END;
$$;