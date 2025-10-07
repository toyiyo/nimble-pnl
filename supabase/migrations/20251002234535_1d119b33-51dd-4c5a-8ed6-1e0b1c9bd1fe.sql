
-- Fix process_unified_inventory_deduction to use sale_date for transaction timestamp
-- This ensures historical inventory deductions are recorded on the correct date

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
    v_deduction_in_oz NUMERIC;
    v_package_size_oz NUMERIC;
    v_reference_id text;
    v_sale_timestamp timestamp with time zone;
BEGIN
    -- Convert sale_date string to timestamp (use start of day in UTC)
    v_sale_timestamp := (p_sale_date || ' 00:00:00')::timestamp with time zone;

    -- Create unique reference_id using external_order_id if available
    IF p_external_order_id IS NOT NULL THEN
        v_reference_id := p_external_order_id || '_' || p_pos_item_name || '_' || p_sale_date;
    ELSE
        v_reference_id := p_pos_item_name || '_' || p_sale_date;
    END IF;

    -- Check if already processed
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

    -- Initialize result object
    v_result := jsonb_build_object(
        'recipe_name', '',
        'ingredients_deducted', '[]'::jsonb,
        'total_cost', 0
    );

    -- Try to find a direct product mapping first
    SELECT * INTO v_product_record
    FROM products 
    WHERE restaurant_id = p_restaurant_id 
        AND pos_item_name = p_pos_item_name
    LIMIT 1;

    IF v_product_record.id IS NOT NULL THEN
        -- DIRECT PRODUCT SALE
        v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_product_record.name));
        v_purchase_unit_deduction := p_quantity_sold;
        
        UPDATE products 
        SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
            updated_at = now()
        WHERE id = v_product_record.id
        RETURNING current_stock INTO v_current_stock;

        v_total_cost := v_purchase_unit_deduction * COALESCE(v_product_record.cost_per_unit, 0);

        -- Use v_sale_timestamp instead of now() for created_at
        INSERT INTO inventory_transactions (
            restaurant_id, product_id, quantity, unit_cost, total_cost,
            transaction_type, reason, reference_id, performed_by, created_at
        ) VALUES (
            p_restaurant_id, v_product_record.id, -v_purchase_unit_deduction,
            v_product_record.cost_per_unit, -v_total_cost, 'usage',
            'Direct POS sale: ' || p_pos_item_name,
            v_reference_id, auth.uid(), v_sale_timestamp
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
        -- RECIPE-BASED SALE
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
            
            IF lower(v_ingredient_record.unit::text) = lower(COALESCE(v_ingredient_record.uom_purchase, '')) THEN
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            ELSIF lower(v_ingredient_record.product_name) LIKE '%rice%' AND 
                  lower(v_ingredient_record.unit::text) = 'cup' THEN
                v_deduction_in_oz := v_deduction_amount * 6.3;
                v_package_size_oz := COALESCE(v_ingredient_record.size_value, 1);
                v_purchase_unit_deduction := v_deduction_in_oz / v_package_size_oz;
                v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_oz) * 6.3;
            ELSE
                v_purchase_unit_deduction := v_deduction_amount;
                v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            END IF;
            
            UPDATE products 
            SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
                updated_at = now()
            WHERE id = v_ingredient_record.product_id
            RETURNING current_stock INTO v_current_stock;

            v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

            -- Use v_sale_timestamp instead of now() for created_at
            INSERT INTO inventory_transactions (
                restaurant_id, product_id, quantity, unit_cost, total_cost,
                transaction_type, reason, reference_id, performed_by, created_at
            ) VALUES (
                p_restaurant_id, v_ingredient_record.product_id, -v_purchase_unit_deduction,
                v_ingredient_record.cost_per_unit, -(v_deduction_amount * v_cost_per_recipe_unit),
                'usage', 'POS sale: ' || p_pos_item_name || ' (Recipe: ' || v_recipe_record.name || ')',
                v_reference_id, auth.uid(), v_sale_timestamp
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
