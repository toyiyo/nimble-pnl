-- Enhanced process_unified_inventory_deduction with comprehensive logging and audit trails
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer,
    p_sale_date text,
    p_external_order_id text DEFAULT NULL
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
    v_conversion_method text;
BEGIN
    -- Check for duplicate processing
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

    -- ALL DEDUCTIONS MUST GO THROUGH RECIPES
    -- Find matching recipe by POS item name
    SELECT * INTO v_recipe_record
    FROM recipes 
    WHERE restaurant_id = p_restaurant_id 
        AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
        AND is_active = true
    LIMIT 1;

    -- If no recipe found, log and return empty result
    IF v_recipe_record.id IS NULL THEN
        RAISE NOTICE 'No recipe found for POS item "%". Skipping deduction.', p_pos_item_name;
        RETURN v_result;
    END IF;

    -- Check if recipe has ingredients
    IF NOT EXISTS (
        SELECT 1
        FROM recipe_ingredients ri
        WHERE ri.recipe_id = v_recipe_record.id
    ) THEN
        RAISE NOTICE 'Recipe "%" (ID: %) has no ingredients. Skipping deduction.', 
            v_recipe_record.name, 
            v_recipe_record.id;
        RETURN v_result;
    END IF;

    v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

    -- Process each ingredient
    FOR v_ingredient_record IN 
        SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit, 
               p.uom_purchase, p.uom_recipe, p.size_value, p.size_unit, p.id as product_id
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
            
        -- Container unit conversions (bottle, can, jar, container)
        ELSIF v_purchase_unit_lower IN ('bottle', 'container', 'can', 'jar') THEN
            DECLARE
                v_recipe_in_ml NUMERIC := 0;
                v_package_size_ml NUMERIC;
            BEGIN
                -- Check for missing size data
                IF v_ingredient_record.size_value IS NULL OR v_ingredient_record.size_unit IS NULL THEN
                    RAISE NOTICE 'Missing size information for product "%" (ID: %). Required for container conversion. Using 1:1 ratio.',
                        v_ingredient_record.product_name,
                        v_ingredient_record.product_id;
                    v_conversion_result := NULL;
                ELSE
                    -- Convert recipe unit to ml
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
            
        -- Weight-based conversions (bag, box, lb, kg)
        ELSIF v_purchase_unit_lower IN ('lb', 'kg', 'bag', 'box') THEN
            DECLARE
                v_recipe_in_g NUMERIC := 0;
                v_package_size_g NUMERIC;
            BEGIN
                -- Check for missing size data
                IF v_ingredient_record.size_value IS NULL OR v_ingredient_record.size_unit IS NULL THEN
                    RAISE NOTICE 'Missing size information for product "%" (ID: %). Required for weight conversion. Using 1:1 ratio.',
                        v_ingredient_record.product_name,
                        v_ingredient_record.product_id;
                    v_conversion_result := NULL;
                ELSE
                    -- Convert recipe unit to grams
                    IF v_recipe_unit_lower = 'g' THEN
                        v_recipe_in_g := v_deduction_amount;
                    ELSIF v_recipe_unit_lower = 'kg' THEN
                        v_recipe_in_g := v_deduction_amount * 1000;
                    ELSIF v_recipe_unit_lower = 'lb' THEN
                        v_recipe_in_g := v_deduction_amount * 453.592;
                    ELSIF v_recipe_unit_lower = 'oz' THEN
                        v_recipe_in_g := v_deduction_amount * 28.3495;
                    -- Product-specific conversions
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
        ELSE
            -- Unknown unit combination - log it
            RAISE NOTICE 'Unsupported unit combination: recipe unit "%" to purchase unit "%" for ingredient "%" in recipe "%". No conversion rule found. Using 1:1.',
                v_recipe_unit_lower,
                v_purchase_unit_lower,
                v_ingredient_record.product_name,
                v_recipe_record.name;
        END IF;
        
        -- Fallback to 1:1 if no conversion succeeded
        IF v_conversion_result IS NULL THEN
            RAISE NOTICE 'Conversion failed for ingredient "%" in recipe "%" (recipe unit: "%" -> purchase unit: "%"). Using 1:1 ratio for deduction.',
                v_ingredient_record.product_name,
                v_recipe_record.name,
                v_recipe_unit_lower,
                v_purchase_unit_lower;
            v_purchase_unit_deduction := v_deduction_amount;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            v_conversion_method := 'fallback';
        END IF;
        
        -- Check if deduction would exceed current stock
        SELECT current_stock INTO v_current_stock 
        FROM products 
        WHERE id = v_ingredient_record.product_id;
        
        IF (v_current_stock - v_purchase_unit_deduction) < 0 THEN
            RAISE NOTICE 'Deduction of % % would exceed current stock (% %) for product "%". Stock will be capped at zero.',
                v_purchase_unit_deduction,
                v_purchase_unit_lower,
                v_current_stock,
                v_purchase_unit_lower,
                v_ingredient_record.product_name;
        END IF;
        
        -- Update product stock (capped at 0)
        UPDATE products 
        SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
            updated_at = now()
        WHERE id = v_ingredient_record.product_id
        RETURNING current_stock INTO v_current_stock;
        
        -- Log when stock reaches zero
        IF v_current_stock = 0 THEN
            RAISE NOTICE 'Stock for product "%" (ID: %) has been fully depleted.',
                v_ingredient_record.product_name,
                v_ingredient_record.product_id;
        END IF;
        
        -- Log deduction details
        RAISE NOTICE 'Deducted % % (% % in purchase units) from inventory for recipe "%" ingredient "%". Remaining stock: % %',
            v_deduction_amount,
            v_recipe_unit_lower,
            v_purchase_unit_deduction,
            v_purchase_unit_lower,
            v_recipe_record.name,
            v_ingredient_record.product_name,
            v_current_stock,
            v_purchase_unit_lower;

        v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

        -- Create inventory transaction
        INSERT INTO inventory_transactions (
            restaurant_id, product_id, quantity, unit_cost, total_cost,
            transaction_type, reason, reference_id, performed_by, created_at
        ) VALUES (
            p_restaurant_id, v_ingredient_record.product_id, -v_purchase_unit_deduction,
            v_ingredient_record.cost_per_unit, -(v_deduction_amount * v_cost_per_recipe_unit),
            'usage', 'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ')',
            v_reference_id, auth.uid(), now()
        );

        -- Build audit trail with conversion method
        v_ingredients_deducted := v_ingredients_deducted || jsonb_build_object(
            'product_name', v_ingredient_record.product_name,
            'quantity_recipe_units', v_deduction_amount,
            'recipe_unit', v_recipe_unit_lower,
            'quantity_purchase_units', v_purchase_unit_deduction,
            'purchase_unit', COALESCE(v_purchase_unit_lower, 'unit'),
            'remaining_stock_purchase_units', v_current_stock,
            'conversion_method', COALESCE(v_conversion_method, 'unknown')
        );
    END LOOP;

    v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients_deducted);
    v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));

    RETURN v_result;
END;
$function$;

-- Add helpful comment about future enhancements
COMMENT ON FUNCTION public.process_unified_inventory_deduction IS 
'Enhanced inventory deduction function with comprehensive logging.
Future improvement: Consider using unit reference tables and unit_conversions table 
for more maintainable and dynamic unit management instead of hardcoded conversions.';