-- Fix recipe cost calculation to properly handle unit conversions
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
      cost_impact NUMERIC;
      recipe_unit_lower TEXT := lower(ingredient_record.unit);
      purchase_unit_lower TEXT := lower(COALESCE(ingredient_record.uom_purchase, ''));
      recipe_quantity_in_purchase_units NUMERIC;
    BEGIN
      -- CORE FIX: Only do direct multiplication when units match AND there's no size packaging
      -- Otherwise, we need to calculate the fractional cost based on package size
      
      IF recipe_unit_lower = purchase_unit_lower AND COALESCE(ingredient_record.size_value, 0) = 0 THEN
        -- Direct match with no packaging info - simple multiplication
        cost_impact := ingredient_record.quantity * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle oz to L conversion (1 oz = 0.0295735 L)
      ELSIF recipe_unit_lower = 'oz' AND purchase_unit_lower = 'l' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 0.0295735;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle L to oz conversion (1 L = 33.814 oz)
      ELSIF recipe_unit_lower = 'l' AND purchase_unit_lower = 'oz' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 33.814;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle oz to ml conversion (1 oz = 29.5735 ml)
      ELSIF recipe_unit_lower = 'oz' AND purchase_unit_lower = 'ml' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 29.5735;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle ml to oz conversion
      ELSIF recipe_unit_lower = 'ml' AND purchase_unit_lower = 'oz' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity / 29.5735;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle ml to L conversion
      ELSIF recipe_unit_lower = 'ml' AND purchase_unit_lower = 'l' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 0.001;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle L to ml conversion
      ELSIF recipe_unit_lower = 'l' AND purchase_unit_lower = 'ml' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 1000;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle product-specific conversions (like rice: 1 cup = 6.3 oz)
      ELSIF lower(ingredient_record.product_name) LIKE '%rice%' AND 
         recipe_unit_lower = 'cup' AND 
         purchase_unit_lower = 'oz' THEN
        recipe_quantity_in_purchase_units := ingredient_record.quantity * 6.3;
        cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        
      ELSE
        -- Default: Use size-based conversion
        -- If we have size_value, calculate the cost per that unit
        -- Then multiply by recipe quantity and divide by conversion factor
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Cost per package (cost_per_unit is per purchase unit, e.g., per bottle)
          -- Total package size (size_value * package_qty, e.g., 750ml * 1 = 750ml per bottle)
          -- Cost per size unit = cost_per_unit / (size_value * package_qty)
          -- Then multiply by recipe quantity adjusted by conversion factor
          
          DECLARE
            package_total_size NUMERIC := COALESCE(ingredient_record.size_value, 1) * COALESCE(ingredient_record.package_qty, 1);
            cost_per_size_unit NUMERIC := COALESCE(ingredient_record.cost_per_unit, 0) / package_total_size;
          BEGIN
            recipe_quantity_in_purchase_units := ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1);
            cost_impact := recipe_quantity_in_purchase_units * cost_per_size_unit;
          END;
        ELSE
          -- No size info, use conversion factor only
          recipe_quantity_in_purchase_units := ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1);
          cost_impact := recipe_quantity_in_purchase_units * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
      END IF;
      
      total_cost := total_cost + cost_impact;
    END;
  END LOOP;
  
  RETURN total_cost;
END;
$function$;