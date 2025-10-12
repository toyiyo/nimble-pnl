-- Update simulate_inventory_deduction to return conversion_method and conversion_warnings
-- This matches the enhanced process_unified_inventory_deduction function

CREATE OR REPLACE FUNCTION public.simulate_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer
)
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
    v_result jsonb := '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0, "conversion_warnings": []}';
    v_ingredients jsonb := '[]';
    v_conversion_warnings jsonb := '[]';
    v_total_cost NUMERIC := 0;
    v_cost_per_recipe_unit NUMERIC;
    v_recipe_unit_lower text;
    v_purchase_unit_lower text;
    v_conversion_result NUMERIC;
    v_conversion_method text;
BEGIN
    SELECT * INTO v_recipe_record
    FROM recipes 
    WHERE restaurant_id = p_restaurant_id 
        AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
        AND is_active = true
    LIMIT 1;

    IF v_recipe_record.id IS NULL THEN
        RETURN '{"recipe_name": "", "ingredients_deducted": [], "total_cost": 0, "conversion_warnings": []}';
    END IF;

    v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

    FOR v_ingredient_record IN 
        SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit,
               p.uom_purchase, p.uom_recipe, p.size_value, p.size_unit
        FROM recipe_ingredients ri
        JOIN products p ON ri.product_id = p.id
        WHERE ri.recipe_id = v_recipe_record.id
    LOOP
        v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;
        v_recipe_unit_lower := lower(v_ingredient_record.unit::text);
        v_purchase_unit_lower := lower(COALESCE(v_ingredient_record.uom_purchase, ''));
        
        v_conversion_result := NULL;
        v_conversion_method := NULL;
        
        -- Direct match (1:1)
        IF v_recipe_unit_lower = v_purchase_unit_lower THEN
            v_purchase_unit_deduction := v_deduction_amount;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            v_conversion_method := '1:1';
            
        -- Container unit conversions
        ELSIF v_purchase_unit_lower IN ('bottle', 'container', 'can', 'jar') THEN
            DECLARE
                v_recipe_in_ml NUMERIC := 0;
                v_package_size_ml NUMERIC;
            BEGIN
                IF v_ingredient_record.size_value IS NULL OR v_ingredient_record.size_unit IS NULL THEN
                    v_conversion_result := NULL;
                    v_conversion_method := 'fallback_1:1';
                ELSE
                    IF v_recipe_unit_lower = 'oz' THEN v_recipe_in_ml := v_deduction_amount * 29.5735;
                    ELSIF v_recipe_unit_lower = 'ml' THEN v_recipe_in_ml := v_deduction_amount;
                    ELSIF v_recipe_unit_lower = 'l' THEN v_recipe_in_ml := v_deduction_amount * 1000;
                    ELSIF v_recipe_unit_lower = 'cup' THEN v_recipe_in_ml := v_deduction_amount * 236.588;
                    ELSIF v_recipe_unit_lower = 'tbsp' THEN v_recipe_in_ml := v_deduction_amount * 14.7868;
                    ELSIF v_recipe_unit_lower = 'tsp' THEN v_recipe_in_ml := v_deduction_amount * 4.92892;
                    ELSIF v_recipe_unit_lower = 'gal' THEN v_recipe_in_ml := v_deduction_amount * 3785.41;
                    ELSIF v_recipe_unit_lower = 'qt' THEN v_recipe_in_ml := v_deduction_amount * 946.353;
                    END IF;
                    
                    IF v_recipe_in_ml > 0 THEN
                        v_package_size_ml := v_ingredient_record.size_value;
                        IF lower(COALESCE(v_ingredient_record.size_unit, 'ml')) = 'l' THEN
                            v_package_size_ml := v_package_size_ml * 1000;
                        END IF;
                        
                        v_purchase_unit_deduction := v_recipe_in_ml / v_package_size_ml;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_ml) * (v_recipe_in_ml / v_deduction_amount);
                        v_conversion_result := 1;
                        v_conversion_method := 'volume_to_container';
                    END IF;
                END IF;
            END;
            
        -- Weight-based conversions
        ELSIF v_purchase_unit_lower IN ('lb', 'kg', 'bag', 'box') THEN
            DECLARE
                v_recipe_in_g NUMERIC := 0;
                v_package_size_g NUMERIC;
            BEGIN
                IF v_ingredient_record.size_value IS NULL OR v_ingredient_record.size_unit IS NULL THEN
                    v_conversion_result := NULL;
                    v_conversion_method := 'fallback_1:1';
                ELSE
                    IF v_recipe_unit_lower = 'g' THEN v_recipe_in_g := v_deduction_amount;
                    ELSIF v_recipe_unit_lower = 'kg' THEN v_recipe_in_g := v_deduction_amount * 1000;
                    ELSIF v_recipe_unit_lower = 'lb' THEN v_recipe_in_g := v_deduction_amount * 453.592;
                    ELSIF v_recipe_unit_lower = 'oz' THEN v_recipe_in_g := v_deduction_amount * 28.3495;
                    ELSIF lower(v_ingredient_record.product_name) LIKE '%rice%' AND v_recipe_unit_lower = 'cup' THEN
                        v_recipe_in_g := v_deduction_amount * 185;
                    ELSIF lower(v_ingredient_record.product_name) LIKE '%flour%' AND v_recipe_unit_lower = 'cup' THEN
                        v_recipe_in_g := v_deduction_amount * 120;
                    ELSIF lower(v_ingredient_record.product_name) LIKE '%sugar%' AND v_recipe_unit_lower = 'cup' THEN
                        v_recipe_in_g := v_deduction_amount * 200;
                    ELSIF lower(v_ingredient_record.product_name) LIKE '%butter%' AND v_recipe_unit_lower = 'cup' THEN
                        v_recipe_in_g := v_deduction_amount * 227;
                    END IF;
                    
                    IF v_recipe_in_g > 0 THEN
                        v_package_size_g := v_ingredient_record.size_value;
                        IF lower(COALESCE(v_ingredient_record.size_unit, 'g')) = 'kg' THEN
                            v_package_size_g := v_package_size_g * 1000;
                        ELSIF lower(v_ingredient_record.size_unit) = 'lb' THEN
                            v_package_size_g := v_package_size_g * 453.592;
                        ELSIF lower(v_ingredient_record.size_unit) = 'oz' THEN
                            v_package_size_g := v_package_size_g * 28.3495;
                        END IF;
                        
                        v_purchase_unit_deduction := v_recipe_in_g / v_package_size_g;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_g) * (v_recipe_in_g / v_deduction_amount);
                        v_conversion_result := 1;
                        v_conversion_method := 'weight_to_package';
                    END IF;
                END IF;
            END;
        END IF;
        
        -- Fallback to 1:1 if no conversion worked
        IF v_conversion_result IS NULL THEN
            v_purchase_unit_deduction := v_deduction_amount;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            v_conversion_method := 'fallback_1:1';
            
            -- Add conversion warning
            v_conversion_warnings := v_conversion_warnings || jsonb_build_object(
                'product_name', v_ingredient_record.product_name,
                'recipe_quantity', v_ingredient_record.quantity,
                'recipe_unit', v_ingredient_record.unit::text,
                'purchase_unit', COALESCE(v_ingredient_record.uom_purchase, 'unit'),
                'deduction_amount', v_purchase_unit_deduction,
                'warning_type', 'fallback_1:1',
                'message', format('Using 1:1 ratio (missing size info). Add product size to enable %s → %s conversion.',
                    v_ingredient_record.unit::text,
                    COALESCE(v_ingredient_record.uom_purchase, 'unit'))
            );
        END IF;
        
        v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

        v_ingredients := v_ingredients || jsonb_build_object(
            'product_name', v_ingredient_record.product_name,
            'quantity_recipe_units', v_deduction_amount,
            'recipe_unit', v_ingredient_record.unit::text,
            'quantity_purchase_units', v_purchase_unit_deduction,
            'purchase_unit', COALESCE(v_ingredient_record.uom_purchase, 'unit'),
            'remaining_stock_purchase_units', GREATEST(0, v_ingredient_record.current_stock - v_purchase_unit_deduction),
            'conversion_method', v_conversion_method
        );
    END LOOP;

    v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients);
    v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));
    v_result := jsonb_set(v_result, '{conversion_warnings}', v_conversion_warnings);

    RETURN v_result;
END;
$function$;