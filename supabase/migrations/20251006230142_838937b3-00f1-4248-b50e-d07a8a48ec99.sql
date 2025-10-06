-- Fix recipe cost calculation to use package-size-aware pricing for all unit conversions
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
      size_unit_lower TEXT := lower(COALESCE(ingredient_record.size_unit, ''));
      recipe_quantity_in_size_units NUMERIC;
      package_total_size NUMERIC;
      unit_price NUMERIC;
    BEGIN
      -- Calculate package-aware unit price if size_value exists
      IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
        package_total_size := COALESCE(ingredient_record.size_value, 1) * COALESCE(ingredient_record.package_qty, 1);
        unit_price := COALESCE(ingredient_record.cost_per_unit, 0) / package_total_size;
      ELSE
        -- No size info, use cost_per_unit directly
        unit_price := COALESCE(ingredient_record.cost_per_unit, 0);
        package_total_size := 1;
      END IF;
      
      -- Direct unit match with no size packaging
      IF recipe_unit_lower = purchase_unit_lower AND COALESCE(ingredient_record.size_value, 0) = 0 THEN
        cost_impact := ingredient_record.quantity * COALESCE(ingredient_record.cost_per_unit, 0);
        
      -- Handle oz to L conversion (1 oz = 0.0295735 L)
      ELSIF recipe_unit_lower = 'oz' AND purchase_unit_lower = 'l' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe oz to the size_unit (ml or L)
          IF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 29.5735; -- oz to ml
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity * 0.0295735; -- oz to L
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          -- No size info, use direct conversion
          cost_impact := (ingredient_record.quantity * 0.0295735) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle L to oz conversion (1 L = 33.814 oz)
      ELSIF recipe_unit_lower = 'l' AND purchase_unit_lower = 'oz' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe L to the size_unit (oz or ml)
          IF size_unit_lower = 'oz' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 33.814; -- L to oz
          ELSIF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 1000; -- L to ml
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity; -- Same unit
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity * 33.814) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle oz to ml conversion (1 oz = 29.5735 ml)
      ELSIF recipe_unit_lower = 'oz' AND purchase_unit_lower = 'ml' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe oz to the size_unit (ml, L, or oz)
          IF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 29.5735; -- oz to ml
          ELSIF size_unit_lower = 'l' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 0.0295735; -- oz to L
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity; -- oz to oz
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity * 29.5735) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle ml to oz conversion
      ELSIF recipe_unit_lower = 'ml' AND purchase_unit_lower = 'oz' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe ml to the size_unit (oz, ml, or L)
          IF size_unit_lower = 'oz' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity / 29.5735; -- ml to oz
          ELSIF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity; -- ml to ml
          ELSIF size_unit_lower = 'l' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 0.001; -- ml to L
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity / 29.5735;
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity / 29.5735) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle ml to L conversion
      ELSIF recipe_unit_lower = 'ml' AND purchase_unit_lower = 'l' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe ml to the size_unit (L, ml, or oz)
          IF size_unit_lower = 'l' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 0.001; -- ml to L
          ELSIF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity; -- ml to ml
          ELSIF size_unit_lower = 'oz' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity / 29.5735; -- ml to oz
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity * 0.001;
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity * 0.001) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle L to ml conversion
      ELSIF recipe_unit_lower = 'l' AND purchase_unit_lower = 'ml' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe L to the size_unit (ml, L, or oz)
          IF size_unit_lower = 'ml' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 1000; -- L to ml
          ELSIF size_unit_lower = 'l' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity; -- L to L
          ELSIF size_unit_lower = 'oz' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 33.814; -- L to oz
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity * 1000;
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity * 1000) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      -- Handle product-specific conversions (like rice: 1 cup = 6.3 oz)
      ELSIF lower(ingredient_record.product_name) LIKE '%rice%' AND 
         recipe_unit_lower = 'cup' AND 
         purchase_unit_lower = 'oz' THEN
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Convert recipe cup to oz (for rice), then to size_unit
          IF size_unit_lower = 'oz' THEN
            recipe_quantity_in_size_units := ingredient_record.quantity * 6.3; -- cup to oz
          ELSIF size_unit_lower = 'lb' THEN
            recipe_quantity_in_size_units := (ingredient_record.quantity * 6.3) / 16; -- cup to oz to lb
          ELSIF size_unit_lower = 'g' THEN
            recipe_quantity_in_size_units := (ingredient_record.quantity * 6.3) * 28.3495; -- cup to oz to g
          ELSE
            recipe_quantity_in_size_units := ingredient_record.quantity * 6.3;
          END IF;
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          cost_impact := (ingredient_record.quantity * 6.3) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
        
      ELSE
        -- Default: Use size-based conversion with conversion_factor
        IF COALESCE(ingredient_record.size_value, 0) > 0 THEN
          -- Use conversion_factor to adjust recipe quantity, then multiply by unit_price
          recipe_quantity_in_size_units := ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1);
          cost_impact := recipe_quantity_in_size_units * unit_price;
        ELSE
          -- No size info, use conversion factor with cost_per_unit
          cost_impact := (ingredient_record.quantity / COALESCE(ingredient_record.conversion_factor, 1)) * COALESCE(ingredient_record.cost_per_unit, 0);
        END IF;
      END IF;
      
      total_cost := total_cost + cost_impact;
    END;
  END LOOP;
  
  RETURN total_cost;
END;
$function$;