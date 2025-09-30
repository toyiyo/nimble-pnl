-- Fix calculate_recipe_cost to handle direct unit matches correctly
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
      p.size_unit,
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
      recipe_unit_lower TEXT := lower(ingredient_record.unit);
      -- Prioritize uom_purchase over size_unit for actual purchase unit
      actual_purchase_unit TEXT := lower(COALESCE(ingredient_record.uom_purchase, ingredient_record.size_unit, ''));
    BEGIN
      -- Handle direct unit matches first (when recipe unit = purchase unit)
      -- In this case, cost_per_unit is ALREADY the cost per that unit
      IF recipe_unit_lower = actual_purchase_unit THEN
        cost_impact := ingredient_record.quantity * COALESCE(ingredient_record.cost_per_unit, 0);
      -- Handle oz to L conversion (1 oz = 0.0295735 L)
      ELSIF recipe_unit_lower = 'oz' AND actual_purchase_unit = 'l' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity * 0.0295735;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle L to oz conversion (1 L = 33.814 oz)
      ELSIF recipe_unit_lower = 'l' AND actual_purchase_unit = 'oz' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity * 33.814;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle oz to ml conversion (1 oz = 29.5735 ml)
      ELSIF recipe_unit_lower = 'oz' AND actual_purchase_unit = 'ml' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity * 29.5735;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle ml to oz conversion
      ELSIF recipe_unit_lower = 'ml' AND actual_purchase_unit = 'oz' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity / 29.5735;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle ml to L conversion
      ELSIF recipe_unit_lower = 'ml' AND actual_purchase_unit = 'l' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity * 0.001;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle L to ml conversion
      ELSIF recipe_unit_lower = 'l' AND actual_purchase_unit = 'ml' THEN
        recipe_to_purchase_conversion := ingredient_record.quantity * 1000;
        cost_per_purchase_unit := COALESCE(ingredient_record.cost_per_unit, 0) / purchase_quantity;
        cost_impact := recipe_to_purchase_conversion * cost_per_purchase_unit;
      -- Handle product-specific conversions (like rice: 1 cup = 6.3 oz)
      ELSIF lower(ingredient_record.product_name) LIKE '%rice%' AND 
         recipe_unit_lower = 'cup' AND 
         actual_purchase_unit = 'oz' THEN
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
$function$;