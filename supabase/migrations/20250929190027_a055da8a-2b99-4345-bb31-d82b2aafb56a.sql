-- Fix process_unified_inventory_deduction to return ingredients_deducted instead of deductions
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
  p_restaurant_id uuid,
  p_pos_item_name text,
  p_quantity_sold integer,
  p_sale_date text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
    v_product_record RECORD;
    v_recipe_record RECORD;
    v_ingredient_record RECORD;
    v_deduction_amount NUMERIC;
    v_purchase_unit_deduction NUMERIC;
    v_current_stock NUMERIC;
    v_result jsonb;
    v_ingredients_deducted jsonb := '[]'::jsonb;
    v_total_cost NUMERIC := 0;
    v_cost_per_recipe_unit NUMERIC;
    v_deduction_in_oz NUMERIC;
    v_package_size_oz NUMERIC;
BEGIN
    -- Initialize result object properly
    v_result := '{
        "recipe_name": "",
        "ingredients_deducted": [],
        "total_cost": 0
    }'::jsonb;

    -- First, try to find a direct product mapping
    SELECT * INTO v_product_record
    FROM products 
    WHERE restaurant_id = p_restaurant_id 
        AND pos_item_name = p_pos_item_name
    LIMIT 1;

    IF v_product_record.id IS NOT NULL THEN
        -- DIRECT PRODUCT SALE - deduct from product inventory directly
        v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_product_record.name));
        
        -- Calculate deduction in purchase units
        v_purchase_unit_deduction := p_quantity_sold;
        
        -- Get current stock
        SELECT current_stock INTO v_current_stock 
        FROM products 
        WHERE id = v_product_record.id;

        -- Update product stock
        UPDATE products 
        SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
            updated_at = now()
        WHERE id = v_product_record.id;

        -- Get updated stock for response
        SELECT current_stock INTO v_current_stock 
        FROM products 
        WHERE id = v_product_record.id;

        -- Calculate total cost
        v_total_cost := v_purchase_unit_deduction * COALESCE(v_product_record.cost_per_unit, 0);

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
            v_product_record.id,
            -v_purchase_unit_deduction,
            v_product_record.cost_per_unit,
            -v_total_cost,
            'usage',
            'Direct POS sale: ' || p_pos_item_name,
            p_pos_item_name || '_' || p_sale_date,
            auth.uid(),
            now()
        );

        -- Add to ingredients_deducted array
        v_ingredients_deducted := v_ingredients_deducted || jsonb_build_object(
            'product_name', v_product_record.name,
            'quantity_recipe_units', v_purchase_unit_deduction,
            'recipe_unit', COALESCE(v_product_record.uom_purchase, 'unit'),
            'quantity_purchase_units', v_purchase_unit_deduction,
            'purchase_unit', COALESCE(v_product_record.uom_purchase, 'unit'),
            'remaining_stock_purchase_units', v_current_stock
        );

    ELSE
        -- RECIPE-BASED SALE - use enhanced unit conversion logic
        SELECT * INTO v_recipe_record
        FROM recipes 
        WHERE restaurant_id = p_restaurant_id 
            AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
            AND is_active = true
        LIMIT 1;

        IF v_recipe_record.id IS NULL THEN
            -- No mapping found at all
            v_result := jsonb_set(v_result, '{recipe_name}', '""'::jsonb);
            v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients_deducted);
            v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));
            RETURN v_result;
        END IF;

        -- Set recipe-based result
        v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

        -- Loop through recipe ingredients and deduct from inventory using enhanced conversions
        FOR v_ingredient_record IN 
            SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit, 
                   p.uom_purchase, p.uom_recipe, p.size_value, p.size_unit
            FROM recipe_ingredients ri
            JOIN products p ON ri.product_id = p.id
            WHERE ri.recipe_id = v_recipe_record.id
        LOOP
            -- Calculate recipe unit deduction (recipe quantity * sales quantity)
            v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;
            
            -- Check if recipe unit matches purchase unit for direct conversion
            IF lower(v_ingredient_record.unit::text) = lower(COALESCE(v_ingredient_record.uom_purchase, '')) THEN
                -- Direct unit match: 1:1 conversion (e.g., 1 bottle recipe = 1 bottle purchase)
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            -- Handle rice-specific conversion (cup to oz, then oz to purchase unit)
            ELSIF lower(v_ingredient_record.product_name) LIKE '%rice%' AND 
                  lower(v_ingredient_record.unit::text) = 'cup' THEN
                -- Rice-specific conversion: 1 cup = 6.3 oz
                v_deduction_in_oz := v_deduction_amount * 6.3;
                
                -- Get package size in oz
                v_package_size_oz := COALESCE(v_ingredient_record.size_value, 1);
                
                -- Convert oz to purchase units (bags)
                v_purchase_unit_deduction := v_deduction_in_oz / v_package_size_oz;
                
                -- Calculate cost per recipe unit (cup)
                v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_oz) * 6.3;
            ELSE
                -- Default conversion or other product-specific conversions
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            END IF;
            
            -- Get current stock (in purchase units)
            SELECT current_stock INTO v_current_stock 
            FROM products 
            WHERE id = v_ingredient_record.product_id;

            -- Update product stock
            UPDATE products 
            SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
                updated_at = now()
            WHERE id = v_ingredient_record.product_id;

            -- Get updated stock for response
            SELECT current_stock INTO v_current_stock 
            FROM products 
            WHERE id = v_ingredient_record.product_id;

            -- Calculate cost using the correct cost per recipe unit
            v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

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
                -(v_deduction_amount * v_cost_per_recipe_unit),
                'usage',
                'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ', Serving: 1)',
                p_pos_item_name || '_' || p_sale_date,
                auth.uid(),
                now()
            );

            -- Add to ingredients_deducted array
            v_ingredients_deducted := v_ingredients_deducted || jsonb_build_object(
                'product_name', v_ingredient_record.product_name,
                'quantity_recipe_units', v_deduction_amount,
                'recipe_unit', v_ingredient_record.unit::text,
                'quantity_purchase_units', v_purchase_unit_deduction,
                'purchase_unit', COALESCE(v_ingredient_record.uom_purchase, 'unit'),
                'remaining_stock_purchase_units', v_current_stock
            );
        END LOOP;
    END IF;

    -- Set final result
    v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients_deducted);
    v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

    RETURN v_result;
END;
$function$;