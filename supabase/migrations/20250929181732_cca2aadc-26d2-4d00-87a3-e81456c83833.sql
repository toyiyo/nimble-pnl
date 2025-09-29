-- Fix simulate_inventory_deduction to return correct field names
CREATE OR REPLACE FUNCTION public.simulate_inventory_deduction(
  p_restaurant_id uuid, 
  p_pos_item_name text, 
  p_quantity_sold integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recipe_record RECORD;
  v_ingredient_record RECORD;
  v_deduction_amount NUMERIC;
  v_result jsonb := '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0}';
  v_ingredients jsonb := '[]';
  v_total_cost NUMERIC := 0;
BEGIN
  -- Find matching recipe by POS item name
  SELECT * INTO v_recipe_record
  FROM recipes 
  WHERE restaurant_id = p_restaurant_id 
    AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
    AND is_active = true
  LIMIT 1;

  -- If no recipe found, return empty result
  IF v_recipe_record.id IS NULL THEN
    RETURN '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0}';
  END IF;

  -- Set recipe name in result
  v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

  -- Loop through recipe ingredients and calculate what would be deducted
  FOR v_ingredient_record IN 
    SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit
    FROM recipe_ingredients ri
    JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = v_recipe_record.id
  LOOP
    -- Calculate deduction amount (recipe quantity * sales quantity)
    v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;

    -- Add to ingredients array with correct field names for frontend
    v_ingredients := v_ingredients || jsonb_build_object(
      'product_name', v_ingredient_record.product_name,
      'quantity_recipe_units', v_deduction_amount,
      'recipe_unit', v_ingredient_record.unit::text,
      'quantity_purchase_units', v_deduction_amount,
      'purchase_unit', v_ingredient_record.unit::text,
      'remaining_stock_purchase_units', GREATEST(0, v_ingredient_record.current_stock - v_deduction_amount)
    );

    -- Add to total cost
    v_total_cost := v_total_cost + (v_deduction_amount * COALESCE(v_ingredient_record.cost_per_unit, 0));
  END LOOP;

  -- Set final result
  v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients);
  v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

  RETURN v_result;
END;
$$;