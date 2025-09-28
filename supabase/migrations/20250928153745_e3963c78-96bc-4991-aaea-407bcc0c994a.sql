-- Update the calculate_recipe_cost function to use enhanced unit conversion logic
CREATE OR REPLACE FUNCTION public.calculate_recipe_cost(recipe_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_cost NUMERIC := 0;
  ingredient_record RECORD;
  enhanced_conversion_result JSONB;
BEGIN
  FOR ingredient_record IN
    SELECT 
      ri.quantity, 
      ri.unit::text, 
      p.cost_per_unit, 
      p.conversion_factor, 
      p.uom_purchase, 
      p.uom_recipe,
      p.name as product_name,
      p.size_value,
      p.package_qty
    FROM recipe_ingredients ri
    JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = calculate_recipe_cost.recipe_id
  LOOP
    -- Use enhanced unit conversion for accurate cost calculation
    -- This matches the logic in enhancedUnitConversion.ts
    BEGIN
      -- Calculate purchase quantity (size_value * package_qty)
      DECLARE
        purchase_quantity NUMERIC := COALESCE(ingredient_record.size_value, 1) * COALESCE(ingredient_record.package_qty, 1);
        recipe_to_purchase_conversion NUMERIC;
        cost_impact NUMERIC;
      BEGIN
        -- Handle product-specific conversions (like rice: 1 cup = 6.3 oz)
        IF lower(ingredient_record.product_name) LIKE '%rice%' AND 
           lower(ingredient_record.unit) = 'cup' AND 
           lower(COALESCE(ingredient_record.uom_purchase, '')) = 'oz' THEN
          -- Rice-specific conversion: 1 cup = 6.3 oz
          recipe_to_purchase_conversion := ingredient_record.quantity * 6.3;
        ELSE
          -- Standard conversion using conversion_factor
          -- Convert recipe units to purchase units
          recipe_to_purchase_conversion := ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1);
        END IF;
        
        -- Calculate cost impact: units_used * cost_per_purchase_unit
        cost_impact := recipe_to_purchase_conversion * COALESCE(ingredient_record.cost_per_unit, 0);
        
        -- Add to total cost
        total_cost := total_cost + cost_impact;
      END;
    END;
  END LOOP;
  
  RETURN total_cost;
END;
$function$;