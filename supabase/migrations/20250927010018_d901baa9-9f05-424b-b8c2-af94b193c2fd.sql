-- Update the process function to consider serving size in calculations
CREATE OR REPLACE FUNCTION public.process_inventory_deduction(p_restaurant_id uuid, p_pos_item_name text, p_quantity_sold integer, p_sale_date text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recipe_record RECORD;
  v_ingredient_record RECORD;
  v_deduction_amount NUMERIC;
  v_purchase_unit_deduction NUMERIC;
  v_current_stock NUMERIC;
  v_result jsonb := '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0, "already_processed": false}';
  v_ingredients jsonb := '[]';
  v_total_cost NUMERIC := 0;
  v_serving_multiplier NUMERIC := 1;
BEGIN
  -- Check if this sale has already been processed
  IF public.check_sale_already_processed(p_restaurant_id, p_pos_item_name, p_quantity_sold, p_sale_date) THEN
    v_result := jsonb_set(v_result, '{already_processed}', to_jsonb(true));
    v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb('Sale already processed'));
    RETURN v_result;
  END IF;

  -- Find matching recipe by POS item name
  SELECT * INTO v_recipe_record
  FROM recipes 
  WHERE restaurant_id = p_restaurant_id 
    AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
    AND is_active = true
  LIMIT 1;

  -- If no recipe found, return empty result
  IF v_recipe_record.id IS NULL THEN
    RETURN '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0, "already_processed": false}';
  END IF;

  -- Calculate serving size multiplier (default to 1 if null)
  v_serving_multiplier := COALESCE(v_recipe_record.serving_size, 1);

  -- Set recipe name in result
  v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));
  v_result := jsonb_set(v_result, '{serving_size}', to_jsonb(v_serving_multiplier));

  -- Loop through recipe ingredients and deduct from inventory
  FOR v_ingredient_record IN 
    SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit, 
           p.uom_purchase, p.uom_recipe, p.conversion_factor
    FROM recipe_ingredients ri
    JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = v_recipe_record.id
  LOOP
    -- Calculate recipe unit deduction (recipe quantity * sales quantity * serving size)
    v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold * v_serving_multiplier;
    
    -- Convert recipe units to purchase units using conversion factor
    -- If no conversion factor, assume 1:1 ratio
    v_purchase_unit_deduction := v_deduction_amount / COALESCE(v_ingredient_record.conversion_factor, 1);
    
    -- Get current stock (in purchase units)
    SELECT current_stock INTO v_current_stock 
    FROM products 
    WHERE id = v_ingredient_record.product_id;

    -- Update product stock (allowing fractional stock for better accuracy)
    UPDATE products 
    SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
        updated_at = now()
    WHERE id = v_ingredient_record.product_id;

    -- Get updated stock for response
    SELECT current_stock INTO v_current_stock 
    FROM products 
    WHERE id = v_ingredient_record.product_id;

    -- Calculate cost using recipe units and cost per purchase unit
    -- Cost per recipe unit = cost_per_purchase_unit / conversion_factor
    v_total_cost := v_total_cost + (v_deduction_amount * 
      COALESCE(v_ingredient_record.cost_per_unit, 0) / COALESCE(v_ingredient_record.conversion_factor, 1));

    -- Record inventory transaction using 'usage' transaction type
    INSERT INTO inventory_transactions (
      restaurant_id,
      product_id,
      quantity,
      unit_cost,
      total_cost,
      transaction_type,
      reason,
      reference_id,
      performed_by,
      created_at
    ) VALUES (
      p_restaurant_id,
      v_ingredient_record.product_id,
      -v_purchase_unit_deduction,
      v_ingredient_record.cost_per_unit,
      -(v_purchase_unit_deduction * COALESCE(v_ingredient_record.cost_per_unit, 0)),
      'usage',
      'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ', Serving: ' || v_serving_multiplier || ')',
      p_pos_item_name || '_' || p_sale_date,
      auth.uid(),
      now()
    );

    -- Add to ingredients array with both recipe and purchase unit info
    v_ingredients := v_ingredients || jsonb_build_object(
      'product_name', v_ingredient_record.product_name,
      'quantity_recipe_units', v_deduction_amount,
      'recipe_unit', v_ingredient_record.unit::text,
      'quantity_purchase_units', v_purchase_unit_deduction,
      'purchase_unit', COALESCE(v_ingredient_record.uom_purchase, 'unit'),
      'conversion_factor', COALESCE(v_ingredient_record.conversion_factor, 1),
      'remaining_stock_purchase_units', v_current_stock,
      'base_quantity_per_serving', v_ingredient_record.quantity,
      'serving_multiplier', v_serving_multiplier
    );

  END LOOP;

  -- Set final result
  v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients);
  v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

  RETURN v_result;
END;
$function$;