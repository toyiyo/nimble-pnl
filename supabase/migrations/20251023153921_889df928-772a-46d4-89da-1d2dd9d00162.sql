-- Fix fluid oz vs weight oz conversion in inventory deduction
-- When a product's size_unit is a volume unit (gal, L, ml, qt) and recipe uses 'oz',
-- treat 'oz' as fluid ounces, not weight ounces

CREATE OR REPLACE FUNCTION process_unified_inventory_deduction(
  p_restaurant_id UUID,
  p_pos_item_name TEXT,
  p_quantity_sold NUMERIC,
  p_sale_date DATE,
  p_sale_time TIME DEFAULT NULL,
  p_restaurant_timezone TEXT DEFAULT 'America/New_York'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_record RECORD;
  v_ingredient_record RECORD;
  v_deduction_amount NUMERIC;
  v_inventory_impact NUMERIC;
  v_ingredient_cost NUMERIC;
  v_total_cost NUMERIC := 0;
  v_deducted_ingredients JSONB := '[]'::jsonb;
  v_ingredient_detail JSONB;
  v_recipe_unit_lower TEXT;
  v_purchase_unit_lower TEXT;
  v_conversion_ratio NUMERIC;
  v_recipe_in_ml NUMERIC;
  v_size_in_ml NUMERIC;
  v_recipe_in_g NUMERIC;
  v_size_in_g NUMERIC;
  v_sale_timestamp TIMESTAMPTZ;
BEGIN
  -- Convert sale date and time to restaurant's timezone
  IF p_sale_time IS NOT NULL THEN
    v_sale_timestamp := timezone(p_restaurant_timezone, (p_sale_date || ' ' || p_sale_time)::timestamp);
  ELSE
    v_sale_timestamp := timezone(p_restaurant_timezone, p_sale_date::timestamp);
  END IF;

  -- Find the recipe mapped to this POS item
  SELECT r.* INTO v_recipe_record
  FROM recipes r
  INNER JOIN pos_item_recipes pir ON r.id = pir.recipe_id
  INNER JOIN pos_items pi ON pir.pos_item_id = pi.id
  WHERE pi.restaurant_id = p_restaurant_id
    AND pi.name = p_pos_item_name
    AND r.restaurant_id = p_restaurant_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'No recipe found for POS item: ' || p_pos_item_name
    );
  END IF;

  -- Process each ingredient in the recipe
  FOR v_ingredient_record IN
    SELECT 
      ri.product_id,
      ri.quantity as recipe_quantity,
      ri.unit as recipe_unit,
      p.name as product_name,
      p.cost_per_unit,
      p.quantity_per_purchase_unit,
      p.uom_purchase,
      p.size_value,
      p.size_unit,
      p.current_stock
    FROM recipe_ingredients ri
    INNER JOIN products p ON ri.product_id = p.id
    WHERE ri.recipe_id = v_recipe_record.id
  LOOP
    -- Calculate base deduction amount (recipe quantity * portions sold)
    v_deduction_amount := v_ingredient_record.recipe_quantity * p_quantity_sold;
    
    -- Normalize units to lowercase for comparison
    v_recipe_unit_lower := LOWER(TRIM(v_ingredient_record.recipe_unit));
    v_purchase_unit_lower := LOWER(TRIM(v_ingredient_record.uom_purchase));
    
    -- Initialize conversion ratio
    v_conversion_ratio := 1.0;
    v_inventory_impact := v_deduction_amount;

    -- CASE 1: Direct unit match (1:1 conversion)
    IF v_recipe_unit_lower = v_purchase_unit_lower THEN
      v_inventory_impact := v_deduction_amount;
      
    -- CASE 2: Container units (bottle, jar, can, bag, box, case, package, container)
    ELSIF v_purchase_unit_lower IN ('bottle', 'jar', 'can', 'bag', 'box', 'case', 'package', 'container') THEN
      
      -- Check if we have size information
      IF v_ingredient_record.size_value IS NULL OR v_ingredient_record.size_unit IS NULL THEN
        -- No size info, use 1:1 fallback
        v_inventory_impact := v_deduction_amount;
      ELSE
        -- CRITICAL FIX: Check if this is a volume context (fluid oz vs weight oz)
        IF LOWER(TRIM(v_ingredient_record.size_unit)) IN ('gal', 'l', 'ml', 'qt', 'pint', 'cup') AND v_recipe_unit_lower = 'oz' THEN
          -- Treat 'oz' as FLUID OUNCES in volume context
          -- Convert recipe amount to ml (1 fl oz = 29.5735 ml)
          v_recipe_in_ml := v_deduction_amount * 29.5735;
          
          -- Convert container size to ml
          v_size_in_ml := CASE LOWER(TRIM(v_ingredient_record.size_unit))
            WHEN 'ml' THEN v_ingredient_record.size_value
            WHEN 'l' THEN v_ingredient_record.size_value * 1000
            WHEN 'gal' THEN v_ingredient_record.size_value * 3785.41
            WHEN 'qt' THEN v_ingredient_record.size_value * 946.353
            WHEN 'pint' THEN v_ingredient_record.size_value * 473.176
            WHEN 'cup' THEN v_ingredient_record.size_value * 236.588
            ELSE v_ingredient_record.size_value
          END;
          
          -- Calculate containers needed
          IF v_size_in_ml > 0 THEN
            v_inventory_impact := v_recipe_in_ml / v_size_in_ml;
          ELSE
            v_inventory_impact := v_deduction_amount;
          END IF;
          
        -- Volume-based conversions (original logic)
        ELSIF LOWER(TRIM(v_ingredient_record.size_unit)) IN ('oz', 'ml', 'l', 'gal', 'qt', 'pint', 'cup', 'tbsp', 'tsp') 
          AND v_recipe_unit_lower IN ('oz', 'ml', 'l', 'gal', 'qt', 'pint', 'cup', 'tbsp', 'tsp') THEN
          
          -- Convert recipe amount to ml
          v_recipe_in_ml := CASE v_recipe_unit_lower
            WHEN 'ml' THEN v_deduction_amount
            WHEN 'l' THEN v_deduction_amount * 1000
            WHEN 'oz' THEN v_deduction_amount * 29.5735
            WHEN 'gal' THEN v_deduction_amount * 3785.41
            WHEN 'qt' THEN v_deduction_amount * 946.353
            WHEN 'pint' THEN v_deduction_amount * 473.176
            WHEN 'cup' THEN v_deduction_amount * 236.588
            WHEN 'tbsp' THEN v_deduction_amount * 14.7868
            WHEN 'tsp' THEN v_deduction_amount * 4.92892
            ELSE v_deduction_amount
          END;
          
          -- Convert container size to ml
          v_size_in_ml := CASE LOWER(TRIM(v_ingredient_record.size_unit))
            WHEN 'ml' THEN v_ingredient_record.size_value
            WHEN 'l' THEN v_ingredient_record.size_value * 1000
            WHEN 'oz' THEN v_ingredient_record.size_value * 29.5735
            WHEN 'gal' THEN v_ingredient_record.size_value * 3785.41
            WHEN 'qt' THEN v_ingredient_record.size_value * 946.353
            WHEN 'pint' THEN v_ingredient_record.size_value * 473.176
            WHEN 'cup' THEN v_ingredient_record.size_value * 236.588
            WHEN 'tbsp' THEN v_ingredient_record.size_value * 14.7868
            WHEN 'tsp' THEN v_ingredient_record.size_value * 4.92892
            ELSE v_ingredient_record.size_value
          END;
          
          -- Calculate containers needed
          IF v_size_in_ml > 0 THEN
            v_inventory_impact := v_recipe_in_ml / v_size_in_ml;
          ELSE
            v_inventory_impact := v_deduction_amount;
          END IF;
          
        -- Weight-based conversions
        ELSIF LOWER(TRIM(v_ingredient_record.size_unit)) IN ('g', 'kg', 'lb', 'oz')
          AND v_recipe_unit_lower IN ('g', 'kg', 'lb', 'oz') THEN
          
          -- Convert recipe amount to grams
          v_recipe_in_g := CASE v_recipe_unit_lower
            WHEN 'g' THEN v_deduction_amount
            WHEN 'kg' THEN v_deduction_amount * 1000
            WHEN 'lb' THEN v_deduction_amount * 453.592
            WHEN 'oz' THEN v_deduction_amount * 28.3495  -- Weight ounce
            ELSE v_deduction_amount
          END;
          
          -- Convert container size to grams
          v_size_in_g := CASE LOWER(TRIM(v_ingredient_record.size_unit))
            WHEN 'g' THEN v_ingredient_record.size_value
            WHEN 'kg' THEN v_ingredient_record.size_value * 1000
            WHEN 'lb' THEN v_ingredient_record.size_value * 453.592
            WHEN 'oz' THEN v_ingredient_record.size_value * 28.3495  -- Weight ounce
            ELSE v_ingredient_record.size_value
          END;
          
          -- Calculate containers needed
          IF v_size_in_g > 0 THEN
            v_inventory_impact := v_recipe_in_g / v_size_in_g;
          ELSE
            v_inventory_impact := v_deduction_amount;
          END IF;
        ELSE
          -- Incompatible units, use 1:1 fallback
          v_inventory_impact := v_deduction_amount;
        END IF;
      END IF;
      
    -- CASE 3: Standard volume conversions (non-container)
    ELSIF v_recipe_unit_lower IN ('oz', 'ml', 'l', 'gal', 'qt', 'pint', 'cup', 'tbsp', 'tsp')
      AND v_purchase_unit_lower IN ('oz', 'ml', 'l', 'gal', 'qt', 'pint', 'cup', 'tbsp', 'tsp') THEN
      
      v_recipe_in_ml := CASE v_recipe_unit_lower
        WHEN 'ml' THEN v_deduction_amount
        WHEN 'l' THEN v_deduction_amount * 1000
        WHEN 'oz' THEN v_deduction_amount * 29.5735
        WHEN 'gal' THEN v_deduction_amount * 3785.41
        WHEN 'qt' THEN v_deduction_amount * 946.353
        WHEN 'pint' THEN v_deduction_amount * 473.176
        WHEN 'cup' THEN v_deduction_amount * 236.588
        WHEN 'tbsp' THEN v_deduction_amount * 14.7868
        WHEN 'tsp' THEN v_deduction_amount * 4.92892
        ELSE v_deduction_amount
      END;
      
      v_size_in_ml := CASE v_purchase_unit_lower
        WHEN 'ml' THEN 1
        WHEN 'l' THEN 1000
        WHEN 'oz' THEN 29.5735
        WHEN 'gal' THEN 3785.41
        WHEN 'qt' THEN 946.353
        WHEN 'pint' THEN 473.176
        WHEN 'cup' THEN 236.588
        WHEN 'tbsp' THEN 14.7868
        WHEN 'tsp' THEN 4.92892
        ELSE 1
      END;
      
      v_inventory_impact := v_recipe_in_ml / v_size_in_ml;
      
    -- CASE 4: Standard weight conversions (non-container)
    ELSIF v_recipe_unit_lower IN ('g', 'kg', 'lb', 'oz')
      AND v_purchase_unit_lower IN ('g', 'kg', 'lb', 'oz') THEN
      
      v_recipe_in_g := CASE v_recipe_unit_lower
        WHEN 'g' THEN v_deduction_amount
        WHEN 'kg' THEN v_deduction_amount * 1000
        WHEN 'lb' THEN v_deduction_amount * 453.592
        WHEN 'oz' THEN v_deduction_amount * 28.3495
        ELSE v_deduction_amount
      END;
      
      v_size_in_g := CASE v_purchase_unit_lower
        WHEN 'g' THEN 1
        WHEN 'kg' THEN 1000
        WHEN 'lb' THEN 453.592
        WHEN 'oz' THEN 28.3495
        ELSE 1
      END;
      
      v_inventory_impact := v_recipe_in_g / v_size_in_g;
    ELSE
      -- Unknown conversion, use 1:1
      v_inventory_impact := v_deduction_amount;
    END IF;

    -- Calculate ingredient cost
    v_ingredient_cost := v_inventory_impact * COALESCE(v_ingredient_record.cost_per_unit, 0);
    v_total_cost := v_total_cost + v_ingredient_cost;

    -- Build ingredient detail
    v_ingredient_detail := jsonb_build_object(
      'product_id', v_ingredient_record.product_id,
      'product_name', v_ingredient_record.product_name,
      'recipe_quantity', v_ingredient_record.recipe_quantity,
      'recipe_unit', v_ingredient_record.recipe_unit,
      'inventory_deducted', v_inventory_impact,
      'purchase_unit', v_ingredient_record.uom_purchase,
      'cost', v_ingredient_cost
    );
    
    v_deducted_ingredients := v_deducted_ingredients || v_ingredient_detail;

    -- Record inventory transaction
    INSERT INTO inventory_transactions (
      restaurant_id,
      product_id,
      transaction_type,
      quantity,
      cost,
      reference_type,
      reference_id,
      notes,
      transaction_date
    ) VALUES (
      p_restaurant_id,
      v_ingredient_record.product_id,
      'usage',
      -v_inventory_impact,
      -v_ingredient_cost,
      'recipe',
      v_recipe_record.id,
      'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ')',
      v_sale_timestamp
    );

    -- Update product stock
    UPDATE products
    SET 
      current_stock = GREATEST(0, current_stock - v_inventory_impact),
      updated_at = NOW()
    WHERE id = v_ingredient_record.product_id;

  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'recipe_name', v_recipe_record.name,
    'deducted_ingredients', v_deducted_ingredients,
    'total_cost', v_total_cost
  );
END;
$$;