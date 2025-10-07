
-- Fix timezone issue in inventory deduction by using now() instead of constructed midnight timestamp
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid, 
    p_pos_item_name text, 
    p_quantity_sold integer, 
    p_sale_date text, 
    p_external_order_id text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    v_reference_id text;
    v_recipe_unit_lower text;
    v_purchase_unit_lower text;
    v_conversion_result NUMERIC;
BEGIN
    -- Use now() instead of constructing a fake midnight timestamp
    -- This preserves the actual time when the deduction is processed

    IF p_external_order_id IS NOT NULL THEN
        v_reference_id := p_external_order_id || '_' || p_pos_item_name || '_' || p_sale_date;
    ELSE
        v_reference_id := p_pos_item_name || '_' || p_sale_date;
    END IF;

    IF EXISTS (
        SELECT 1 FROM inventory_transactions 
        WHERE restaurant_id = p_restaurant_id 
        AND reference_id = v_reference_id
        AND transaction_type = 'usage'
    ) THEN
        RETURN jsonb_build_object(
            'recipe_name', 'Already processed',
            'ingredients_deducted', '[]'::jsonb,
            'total_cost', 0,
            'already_processed', true
        );
    END IF;

    v_result := jsonb_build_object(
        'recipe_name', '',
        'ingredients_deducted', '[]'::jsonb,
        'total_cost', 0
    );

    -- Try direct product mapping first
    SELECT * INTO v_product_record
    FROM products 
    WHERE restaurant_id = p_restaurant_id 
        AND pos_item_name = p_pos_item_name
    LIMIT 1;

    IF v_product_record.id IS NOT NULL THEN
        v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_product_record.name));
        v_purchase_unit_deduction := p_quantity_sold;
        
        UPDATE products 
        SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
            updated_at = now()
        WHERE id = v_product_record.id
        RETURNING current_stock INTO v_current_stock;

        v_total_cost := v_purchase_unit_deduction * COALESCE(v_product_record.cost_per_unit, 0);

        -- FIXED: Use now() instead of v_sale_timestamp
        INSERT INTO inventory_transactions (
            restaurant_id, product_id, quantity, unit_cost, total_cost,
            transaction_type, reason, reference_id, performed_by, created_at
        ) VALUES (
            p_restaurant_id, v_product_record.id, -v_purchase_unit_deduction,
            v_product_record.cost_per_unit, -v_total_cost, 'usage',
            'Direct POS sale: ' || p_pos_item_name,
            v_reference_id, auth.uid(), now()
        );

        v_ingredients_deducted := v_ingredients_deducted || jsonb_build_object(
            'product_name', v_product_record.name,
            'quantity_recipe_units', v_purchase_unit_deduction,
            'recipe_unit', COALESCE(v_product_record.uom_purchase, 'unit'),
            'quantity_purchase_units', v_purchase_unit_deduction,
            'purchase_unit', COALESCE(v_product_record.uom_purchase, 'unit'),
            'remaining_stock_purchase_units', v_current_stock
        );
    ELSE
        -- Recipe-based sale
        SELECT * INTO v_recipe_record
        FROM recipes 
        WHERE restaurant_id = p_restaurant_id 
            AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
            AND is_active = true
        LIMIT 1;

        IF v_recipe_record.id IS NULL THEN
            RETURN v_result;
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
            
            IF v_recipe_unit_lower = v_purchase_unit_lower THEN
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
                
            ELSIF v_purchase_unit_lower IN ('bottle', 'container', 'can', 'jar') THEN
                DECLARE
                    v_recipe_in_ml NUMERIC := 0;
                    v_package_size_ml NUMERIC;
                BEGIN
                    IF v_recipe_unit_lower = 'oz' THEN
                        v_recipe_in_ml := v_deduction_amount * 29.5735;
                    ELSIF v_recipe_unit_lower = 'ml' THEN
                        v_recipe_in_ml := v_deduction_amount;
                    ELSIF v_recipe_unit_lower = 'l' THEN
                        v_recipe_in_ml := v_deduction_amount * 1000;
                    ELSIF v_recipe_unit_lower = 'cup' THEN
                        v_recipe_in_ml := v_deduction_amount * 236.588;
                    ELSIF v_recipe_unit_lower = 'tbsp' THEN
                        v_recipe_in_ml := v_deduction_amount * 14.7868;
                    ELSIF v_recipe_unit_lower = 'tsp' THEN
                        v_recipe_in_ml := v_deduction_amount * 4.92892;
                    ELSIF v_recipe_unit_lower = 'gal' THEN
                        v_recipe_in_ml := v_deduction_amount * 3785.41;
                    ELSIF v_recipe_unit_lower = 'qt' THEN
                        v_recipe_in_ml := v_deduction_amount * 946.353;
                    END IF;
                    
                    IF v_recipe_in_ml > 0 THEN
                        v_package_size_ml := COALESCE(v_ingredient_record.size_value, 750);
                        IF lower(COALESCE(v_ingredient_record.size_unit, 'ml')) = 'l' THEN
                            v_package_size_ml := v_package_size_ml * 1000;
                        END IF;
                        
                        v_purchase_unit_deduction := v_recipe_in_ml / v_package_size_ml;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_ml) * (v_recipe_in_ml / v_deduction_amount);
                        v_conversion_result := 1;
                    END IF;
                END;
                
            ELSIF v_purchase_unit_lower IN ('lb', 'kg', 'bag', 'box') THEN
                DECLARE
                    v_recipe_in_g NUMERIC := 0;
                    v_package_size_g NUMERIC;
                BEGIN
                    IF v_recipe_unit_lower = 'g' THEN
                        v_recipe_in_g := v_deduction_amount;
                    ELSIF v_recipe_unit_lower = 'kg' THEN
                        v_recipe_in_g := v_deduction_amount * 1000;
                    ELSIF v_recipe_unit_lower = 'lb' THEN
                        v_recipe_in_g := v_deduction_amount * 453.592;
                    ELSIF v_recipe_unit_lower = 'oz' THEN
                        v_recipe_in_g := v_deduction_amount * 28.3495;
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
                        v_package_size_g := COALESCE(v_ingredient_record.size_value, 1000);
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
                    END IF;
                END;
            END IF;
            
            IF v_conversion_result IS NULL THEN
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            END IF;
            
            UPDATE products 
            SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
                updated_at = now()
            WHERE id = v_ingredient_record.product_id
            RETURNING current_stock INTO v_current_stock;

            v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

            -- FIXED: Use now() instead of v_sale_timestamp
            INSERT INTO inventory_transactions (
                restaurant_id, product_id, quantity, unit_cost, total_cost,
                transaction_type, reason, reference_id, performed_by, created_at
            ) VALUES (
                p_restaurant_id, v_ingredient_record.product_id, -v_purchase_unit_deduction,
                v_ingredient_record.cost_per_unit, -(v_deduction_amount * v_cost_per_recipe_unit),
                'usage', 'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ')',
                v_reference_id, auth.uid(), now()
            );

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

    v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients_deducted);
    v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

    RETURN v_result;
END;
$function$;
