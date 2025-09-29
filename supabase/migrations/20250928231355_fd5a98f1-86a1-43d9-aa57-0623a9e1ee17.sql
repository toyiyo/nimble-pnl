-- Fix the recipe cost calculation to handle bottle-to-bottle conversions correctly
CREATE OR REPLACE FUNCTION public.calculate_recipe_cost(recipe_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_cost NUMERIC := 0;
  ingredient_record RECORD;
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
    DECLARE
      purchase_quantity NUMERIC := COALESCE(ingredient_record.size_value, 1) * COALESCE(ingredient_record.package_qty, 1);
      recipe_to_purchase_conversion NUMERIC;
      cost_per_purchase_unit NUMERIC;
      cost_impact NUMERIC;
    BEGIN
      -- Handle direct unit matches first (bottle to bottle, etc.)
      IF lower(ingredient_record.unit) = lower(COALESCE(ingredient_record.uom_purchase, '')) THEN
        -- Direct unit match: 1 bottle recipe = 1 bottle purchase
        cost_impact := ingredient_record.quantity * COALESCE(ingredient_record.cost_per_unit, 0);
      -- Handle product-specific conversions (like rice: 1 cup = 6.3 oz)
      ELSIF lower(ingredient_record.product_name) LIKE '%rice%' AND 
         lower(ingredient_record.unit) = 'cup' AND 
         lower(COALESCE(ingredient_record.uom_purchase, '')) = 'oz' THEN
        -- Rice-specific conversion: 1 cup = 6.3 oz
        recipe_to_purchase_conversion := ingredient_record.quantity * 6.3;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      ELSE
        -- Standard conversion using conversion_factor or size-based conversion
        recipe_to_purchase_conversion := ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1);
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      END IF;
      
      -- Add to total cost
      total_cost := total_cost + cost_impact;
    END;
  END LOOP;
  
  RETURN total_cost;
END;
$function$