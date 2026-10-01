-- Recipe yield deduction (see docs/superpowers/specs/2026-09-30-recipe-yield-waste-design.md)
--
-- process_unified_inventory_deduction ignores products.yield_pct and
-- recipe_ingredients.yield_pct_override, so a low-yield product deducts
-- only the portion quantity, not the raw quantity trim removes.
--
-- Re-creates the function with the same 10-arg signature as
-- 20260705000000_fix_prep_shadow_recipe_costing.sql. Only 3 changes from
-- that version: the ingredient cursor adds effective_yield_pct, the
-- deduction formula divides by it, and the reason text gets a
-- "[yield N%]" suffix when the yield is under 100.
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer,
    p_sale_date text,
    p_external_order_id text DEFAULT NULL::text,
    p_sale_time text DEFAULT NULL::text,
    p_restaurant_timezone text DEFAULT 'America/Chicago'::text,
    p_transaction_type text DEFAULT 'usage'::text,
    p_reason_prefix text DEFAULT 'POS sale'::text,
    p_recipe_id uuid DEFAULT NULL
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
    v_current_stock NUMERIC;
    v_result jsonb;
    v_ingredients_deducted jsonb := '[]'::jsonb;
    v_conversion_warnings jsonb := '[]'::jsonb;
    v_total_cost NUMERIC := 0;
    v_cost_per_recipe_unit NUMERIC;
    v_reference_id text;
    v_recipe_unit_lower text;
    v_purchase_unit_lower text;
    v_conversion_result NUMERIC;
    v_conversion_method text;
    v_transaction_timestamp timestamp with time zone;
    v_local_datetime text;
    v_reason_text text;
    v_size_unit_lower text;
    v_transaction_type text;

    v_volume_units text[] := ARRAY['fl oz', 'ml', 'l', 'cup', 'tbsp', 'tsp', 'gal', 'qt', 'pint'];
    v_weight_units text[] := ARRAY['g', 'kg', 'lb', 'oz'];
    v_container_units text[] := ARRAY['bag', 'box', 'case', 'package', 'container'];
    v_individual_units text[] := ARRAY['each', 'piece', 'unit'];
BEGIN
    v_transaction_type := COALESCE(p_transaction_type, 'usage');
    IF v_transaction_type NOT IN ('usage', 'transfer', 'adjustment', 'waste') THEN
        v_transaction_type := 'usage';
    END IF;

    IF p_sale_time IS NOT NULL AND p_sale_time != '' THEN
        v_local_datetime := p_sale_date || ' ' || p_sale_time;
    ELSE
        v_local_datetime := p_sale_date || ' 00:00:00';
    END IF;

    v_transaction_timestamp := (v_local_datetime::timestamp AT TIME ZONE p_restaurant_timezone) AT TIME ZONE 'UTC';

    IF p_external_order_id IS NOT NULL THEN
        v_reference_id := p_external_order_id || '_' || p_pos_item_name || '_' || p_sale_date;
    ELSE
        v_reference_id := p_pos_item_name || '_' || p_sale_date;
    END IF;

    IF EXISTS (
        SELECT 1 FROM inventory_transactions
        WHERE restaurant_id = p_restaurant_id
        AND reference_id = v_reference_id
        AND transaction_type = v_transaction_type
    ) THEN
        RETURN jsonb_build_object(
            'recipe_name', 'Already processed',
            'ingredients_deducted', '[]'::jsonb,
            'total_cost', 0,
            'conversion_warnings', '[]'::jsonb,
            'already_processed', true
        );
    END IF;

    v_result := jsonb_build_object(
        'recipe_name', '',
        'ingredients_deducted', '[]'::jsonb,
        'total_cost', 0,
        'conversion_warnings', '[]'::jsonb
    );

    IF p_recipe_id IS NOT NULL THEN
        -- Production-run path: direct by-id lookup. The is_active filter is
        -- bypassed ONLY when the recipe is confirmed to be a prep-linked
        -- "shadow" recipe (backs a row in prep_recipes) — that's the sole
        -- case a soft-deleted row must not silently disable deductions for.
        -- This gate is required because process_unified_inventory_deduction
        -- is SECURITY DEFINER and callable directly via PostgREST RPC by any
        -- authenticated client with restaurant access: without it, a caller
        -- could pass an arbitrary p_recipe_id to deduct against any
        -- soft-deleted/hidden recipe, bypassing the is_active gate POS sales
        -- are held to (flagged in review, see PR #582).
        -- Tenant guard (restaurant_id) is preserved in all cases.
        SELECT * INTO v_recipe_record
        FROM recipes r
        WHERE r.id = p_recipe_id
          AND r.restaurant_id = p_restaurant_id
          AND (
            r.is_active = true
            OR EXISTS (
              SELECT 1 FROM prep_recipes pr
              WHERE pr.recipe_id = r.id AND pr.restaurant_id = r.restaurant_id
            )
          );
    ELSE
        -- POS-sale path: unchanged name-based lookup, active recipes only.
        SELECT * INTO v_recipe_record
        FROM recipes
        WHERE restaurant_id = p_restaurant_id
          AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
          AND is_active = true
        LIMIT 1;
    END IF;

    IF v_recipe_record.id IS NULL THEN
        RAISE NOTICE 'No recipe found for POS item "%". Skipping deduction.', p_pos_item_name;
        RETURN v_result;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM recipe_ingredients ri WHERE ri.recipe_id = v_recipe_record.id
    ) THEN
        RAISE NOTICE 'Recipe "%" has no ingredients. Skipping deduction.', v_recipe_record.name;
        RETURN v_result;
    END IF;

    v_result := jsonb_set(v_result, '{recipe_name}', to_jsonb(v_recipe_record.name));

    FOR v_ingredient_record IN
        SELECT ri.*, p.name as product_name, p.current_stock, p.cost_per_unit,
               p.uom_purchase, p.uom_recipe, p.size_value, p.size_unit, p.id as product_id,
               COALESCE(ri.yield_pct_override, p.yield_pct, 100) AS effective_yield_pct
        FROM recipe_ingredients ri
        JOIN products p ON ri.product_id = p.id
        WHERE ri.recipe_id = v_recipe_record.id
    LOOP
        v_deduction_amount := (v_ingredient_record.quantity * p_quantity_sold)
            / (v_ingredient_record.effective_yield_pct / 100.0);
        v_recipe_unit_lower := lower(v_ingredient_record.unit::text);
        v_purchase_unit_lower := lower(COALESCE(v_ingredient_record.uom_purchase, ''));
        v_size_unit_lower := lower(COALESCE(v_ingredient_record.size_unit, ''));

        v_conversion_result := NULL;
        v_conversion_method := NULL;

        -- Direct unit match
        IF v_recipe_unit_lower = v_purchase_unit_lower THEN
            v_purchase_unit_deduction := v_deduction_amount;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            v_conversion_method := '1:1';
            v_conversion_result := 1;

        -- Count-to-Container Conversion
        ELSIF v_recipe_unit_lower = ANY(v_individual_units)
              AND v_purchase_unit_lower = ANY(v_container_units)
              AND COALESCE(v_ingredient_record.size_value, 0) > 0
              AND v_size_unit_lower = ANY(v_individual_units) THEN
            v_purchase_unit_deduction := v_deduction_amount / v_ingredient_record.size_value;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0) / v_ingredient_record.size_value;
            v_conversion_result := 1;
            v_conversion_method := 'count_to_container';

        -- Volume-to-Volume Conversion
        ELSIF v_recipe_unit_lower = ANY(v_volume_units) AND v_size_unit_lower = ANY(v_volume_units) THEN
            DECLARE
                v_recipe_in_ml NUMERIC := 0;
                v_package_size_ml NUMERIC;
            BEGIN
                IF v_ingredient_record.size_value IS NOT NULL AND v_ingredient_record.size_value > 0 THEN
                    CASE v_recipe_unit_lower
                        WHEN 'fl oz' THEN v_recipe_in_ml := v_deduction_amount * 29.5735;
                        WHEN 'ml' THEN v_recipe_in_ml := v_deduction_amount;
                        WHEN 'l' THEN v_recipe_in_ml := v_deduction_amount * 1000;
                        WHEN 'cup' THEN v_recipe_in_ml := v_deduction_amount * 236.588;
                        WHEN 'tbsp' THEN v_recipe_in_ml := v_deduction_amount * 14.7868;
                        WHEN 'tsp' THEN v_recipe_in_ml := v_deduction_amount * 4.92892;
                        WHEN 'gal' THEN v_recipe_in_ml := v_deduction_amount * 3785.41;
                        WHEN 'qt' THEN v_recipe_in_ml := v_deduction_amount * 946.353;
                        WHEN 'pint' THEN v_recipe_in_ml := v_deduction_amount * 473.176;
                        ELSE v_recipe_in_ml := 0;
                    END CASE;

                    IF v_recipe_in_ml > 0 THEN
                        v_package_size_ml := v_ingredient_record.size_value;
                        CASE v_size_unit_lower
                            WHEN 'ml' THEN NULL;
                            WHEN 'l' THEN v_package_size_ml := v_package_size_ml * 1000;
                            WHEN 'gal' THEN v_package_size_ml := v_package_size_ml * 3785.41;
                            WHEN 'qt' THEN v_package_size_ml := v_package_size_ml * 946.353;
                            WHEN 'fl oz' THEN v_package_size_ml := v_package_size_ml * 29.5735;
                            WHEN 'cup' THEN v_package_size_ml := v_package_size_ml * 236.588;
                            WHEN 'tbsp' THEN v_package_size_ml := v_package_size_ml * 14.7868;
                            WHEN 'tsp' THEN v_package_size_ml := v_package_size_ml * 4.92892;
                            WHEN 'pint' THEN v_package_size_ml := v_package_size_ml * 473.176;
                            ELSE NULL;
                        END CASE;

                        v_purchase_unit_deduction := v_recipe_in_ml / v_package_size_ml;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_ml) * (v_recipe_in_ml / v_deduction_amount);
                        v_conversion_result := 1;
                        v_conversion_method := 'volume_to_volume';
                    END IF;
                END IF;
            END;

        -- Weight-to-Weight Conversion
        ELSIF v_recipe_unit_lower = ANY(v_weight_units) AND v_size_unit_lower = ANY(v_weight_units) THEN
            DECLARE
                v_recipe_in_g NUMERIC := 0;
                v_package_size_g NUMERIC;
            BEGIN
                IF v_ingredient_record.size_value IS NOT NULL AND v_ingredient_record.size_value > 0 THEN
                    CASE v_recipe_unit_lower
                        WHEN 'g' THEN v_recipe_in_g := v_deduction_amount;
                        WHEN 'kg' THEN v_recipe_in_g := v_deduction_amount * 1000;
                        WHEN 'lb' THEN v_recipe_in_g := v_deduction_amount * 453.592;
                        WHEN 'oz' THEN v_recipe_in_g := v_deduction_amount * 28.3495;
                        ELSE v_recipe_in_g := 0;
                    END CASE;

                    IF v_recipe_in_g > 0 THEN
                        v_package_size_g := v_ingredient_record.size_value;
                        CASE v_size_unit_lower
                            WHEN 'g' THEN NULL;
                            WHEN 'kg' THEN v_package_size_g := v_package_size_g * 1000;
                            WHEN 'lb' THEN v_package_size_g := v_package_size_g * 453.592;
                            WHEN 'oz' THEN v_package_size_g := v_package_size_g * 28.3495;
                            ELSE NULL;
                        END CASE;

                        v_purchase_unit_deduction := v_recipe_in_g / v_package_size_g;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_g) * (v_recipe_in_g / v_deduction_amount);
                        v_conversion_result := 1;
                        v_conversion_method := 'weight_to_weight';
                    END IF;
                END IF;
            END;

        -- Density Conversion (Volume to Weight)
        ELSIF v_recipe_unit_lower IN ('cup', 'tsp', 'tbsp') AND v_size_unit_lower = ANY(v_weight_units) THEN
            DECLARE
                v_recipe_in_g NUMERIC := 0;
                v_package_size_g NUMERIC;
            BEGIN
                IF v_ingredient_record.size_value IS NOT NULL AND v_ingredient_record.size_value > 0 THEN
                    IF lower(v_ingredient_record.product_name) LIKE '%rice%' AND v_recipe_unit_lower = 'cup' THEN
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
                        CASE v_size_unit_lower
                            WHEN 'g' THEN NULL;
                            WHEN 'kg' THEN v_package_size_g := v_package_size_g * 1000;
                            WHEN 'lb' THEN v_package_size_g := v_package_size_g * 453.592;
                            WHEN 'oz' THEN v_package_size_g := v_package_size_g * 28.3495;
                            ELSE NULL;
                        END CASE;

                        v_purchase_unit_deduction := v_recipe_in_g / v_package_size_g;
                        v_cost_per_recipe_unit := (COALESCE(v_ingredient_record.cost_per_unit, 0) / v_package_size_g) * (v_recipe_in_g / v_deduction_amount);
                        v_conversion_result := 1;
                        v_conversion_method := 'density_to_weight';
                    END IF;
                END IF;
            END;
        END IF;

        -- Fallback to 1:1
        IF v_conversion_result IS NULL THEN
            v_purchase_unit_deduction := v_deduction_amount;
            v_cost_per_recipe_unit := COALESCE(v_ingredient_record.cost_per_unit, 0);
            v_conversion_method := 'fallback_1:1';

            v_conversion_warnings := v_conversion_warnings || jsonb_build_object(
                'product_name', v_ingredient_record.product_name,
                'recipe_quantity', v_deduction_amount,
                'recipe_unit', v_recipe_unit_lower,
                'purchase_unit', v_purchase_unit_lower,
                'package_size_unit', v_size_unit_lower,
                'deduction_amount', v_purchase_unit_deduction,
                'warning_type', 'fallback_1:1',
                'message', format('Could not convert %s %s to %s. Using 1:1 ratio.',
                    v_deduction_amount, v_recipe_unit_lower, v_purchase_unit_lower)
            );
        END IF;

        UPDATE products
        SET current_stock = GREATEST(0, current_stock - v_purchase_unit_deduction),
            updated_at = now()
        WHERE id = v_ingredient_record.product_id;

        SELECT current_stock INTO v_current_stock
        FROM products WHERE id = v_ingredient_record.product_id;

        v_total_cost := v_total_cost + (v_deduction_amount * v_cost_per_recipe_unit);

        v_reason_text := format('%s: %s (Recipe: %s) [%s: %s %s → %s %s]%s',
            COALESCE(p_reason_prefix, 'POS sale'),
            p_pos_item_name,
            v_recipe_record.name,
            CASE
                WHEN v_conversion_method = 'fallback_1:1' THEN '⚠️ FALLBACK'
                WHEN v_conversion_method = '1:1' THEN '✓ 1:1'
                WHEN v_conversion_method = 'count_to_container' THEN '✓ CNT-CNTR'
                WHEN v_conversion_method = 'volume_to_volume' THEN '✓ VOL-VOL'
                WHEN v_conversion_method = 'weight_to_weight' THEN '✓ WGT-WGT'
                WHEN v_conversion_method = 'density_to_weight' THEN '✓ DENSITY'
                ELSE '✓'
            END,
            ROUND(v_deduction_amount, 2),
            v_recipe_unit_lower,
            ROUND(v_purchase_unit_deduction, 3),
            v_purchase_unit_lower,
            CASE
                WHEN v_ingredient_record.effective_yield_pct < 100
                    THEN format(' [yield %s%%]', v_ingredient_record.effective_yield_pct)
                ELSE ''
            END
        );

        INSERT INTO inventory_transactions (
            restaurant_id, product_id, quantity, unit_cost, total_cost,
            transaction_type, reason, reference_id, performed_by, created_at
        ) VALUES (
            p_restaurant_id,
            v_ingredient_record.product_id,
            -v_purchase_unit_deduction,
            v_ingredient_record.cost_per_unit,
            -(v_purchase_unit_deduction * COALESCE(v_ingredient_record.cost_per_unit, 0)),
            v_transaction_type,
            v_reason_text,
            v_reference_id,
            auth.uid(),
            v_transaction_timestamp
        );

        v_ingredients_deducted := v_ingredients_deducted || jsonb_build_object(
            'product_name', v_ingredient_record.product_name,
            'quantity_recipe_units', v_deduction_amount,
            'recipe_unit', v_ingredient_record.unit::text,
            'quantity_purchase_units', v_purchase_unit_deduction,
            'purchase_unit', COALESCE(v_ingredient_record.uom_purchase, 'unit'),
            'remaining_stock_purchase_units', v_current_stock,
            'conversion_method', v_conversion_method
        );
    END LOOP;

    v_result := jsonb_set(v_result, '{ingredients_deducted}', v_ingredients_deducted);
    v_result := jsonb_set(v_result, '{total_cost}', to_jsonb(v_total_cost));
    v_result := jsonb_set(v_result, '{conversion_warnings}', v_conversion_warnings);

    RETURN v_result;
END;
$function$;
