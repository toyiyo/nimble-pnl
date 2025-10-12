-- Create function to upsert product-supplier relationships
CREATE OR REPLACE FUNCTION public.upsert_product_supplier(
  p_restaurant_id UUID,
  p_product_id UUID,
  p_supplier_id UUID,
  p_unit_cost NUMERIC,
  p_quantity NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_record RECORD;
  v_new_avg_cost NUMERIC;
  v_new_purchase_count INTEGER;
BEGIN
  -- Check if relationship already exists
  SELECT * INTO v_existing_record
  FROM product_suppliers
  WHERE restaurant_id = p_restaurant_id
    AND product_id = p_product_id
    AND supplier_id = p_supplier_id;

  IF FOUND THEN
    -- Update existing record
    -- Calculate new average cost: ((old_avg * old_count) + new_cost) / (old_count + 1)
    v_new_purchase_count := COALESCE(v_existing_record.purchase_count, 0) + 1;
    v_new_avg_cost := (
      (COALESCE(v_existing_record.average_unit_cost, 0) * COALESCE(v_existing_record.purchase_count, 0)) + p_unit_cost
    ) / v_new_purchase_count;

    UPDATE product_suppliers
    SET
      last_unit_cost = p_unit_cost,
      last_purchase_date = NOW(),
      last_purchase_quantity = p_quantity,
      average_unit_cost = v_new_avg_cost,
      purchase_count = v_new_purchase_count,
      updated_at = NOW()
    WHERE restaurant_id = p_restaurant_id
      AND product_id = p_product_id
      AND supplier_id = p_supplier_id;
  ELSE
    -- Insert new record
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
      p_unit_cost,  -- First purchase, so avg = current
      1,
      -- Set as preferred if this is the first supplier for this product
      NOT EXISTS (
        SELECT 1 FROM product_suppliers
        WHERE restaurant_id = p_restaurant_id
          AND product_id = p_product_id
      )
    );
  END IF;
END;
$$;