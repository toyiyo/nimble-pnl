-- Fix bulk_process_historical_sales to pass integer quantity instead of numeric
-- This resolves the parameter type mismatch with process_unified_inventory_deduction

CREATE OR REPLACE FUNCTION public.bulk_process_historical_sales(
    p_restaurant_id uuid, 
    p_start_date date, 
    p_end_date date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_sale RECORD;
    v_processed_count integer := 0;
    v_skipped_count integer := 0;
    v_error_count integer := 0;
    v_result jsonb;
    v_deduction_result jsonb;
    v_restaurant_timezone text;
BEGIN
    -- Get restaurant timezone
    SELECT timezone INTO v_restaurant_timezone
    FROM restaurants
    WHERE id = p_restaurant_id;
    
    v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');

    -- Process all sales in the date range, including sale_time
    FOR v_sale IN 
        SELECT 
            item_name,
            quantity,
            sale_date::text,
            sale_time::text,
            external_order_id
        FROM unified_sales
        WHERE restaurant_id = p_restaurant_id
            AND sale_date BETWEEN p_start_date AND p_end_date
        ORDER BY sale_date, created_at
    LOOP
        BEGIN
            -- Process the sale with integer quantity (fixed type mismatch)
            v_deduction_result := public.process_unified_inventory_deduction(
                p_restaurant_id,
                v_sale.item_name,
                v_sale.quantity::integer,  -- FIXED: Changed from numeric to integer
                v_sale.sale_date,
                v_sale.external_order_id,
                v_sale.sale_time,
                v_restaurant_timezone
            );

            -- Check if it was already processed or actually processed
            IF (v_deduction_result->>'already_processed')::boolean THEN
                v_skipped_count := v_skipped_count + 1;
            ELSIF v_deduction_result->>'recipe_name' != '' THEN
                v_processed_count := v_processed_count + 1;
            ELSE
                v_skipped_count := v_skipped_count + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
            RAISE NOTICE 'Error processing sale %: %', v_sale.item_name, SQLERRM;
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'processed', v_processed_count,
        'skipped', v_skipped_count,
        'errors', v_error_count,
        'total', v_processed_count + v_skipped_count + v_error_count
    );
END;
$function$;