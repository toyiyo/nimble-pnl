-- Enhanced Prep Recipes and Production Run Improvements
--
-- This migration:
-- 1. Adds enhanced fields to prep_recipes (category, shelf_life, storage, etc.)
-- 2. Adds shelf_life_days to products table
-- 3. Creates prep_recipe_procedure_steps table for step-by-step instructions
-- 4. Updates process_unified_inventory_deduction to support 'transfer' transaction type
-- 5. Updates complete_production_run to use 'transfer' for prep cooking (not COGS until sold)

-- ============================================================
-- PART 1: Schema Changes for Prep Recipes
-- ============================================================

-- Add new fields to prep_recipes table
ALTER TABLE public.prep_recipes
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'prep',
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER,
  ADD COLUMN IF NOT EXISTS storage_instructions TEXT,
  ADD COLUMN IF NOT EXISTS oven_temp NUMERIC,
  ADD COLUMN IF NOT EXISTS oven_temp_unit TEXT CHECK (oven_temp_unit IS NULL OR oven_temp_unit IN ('F', 'C')),
  ADD COLUMN IF NOT EXISTS equipment_notes TEXT;

-- Add shelf_life_days to products table (for auto-setting from recipe)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS shelf_life_days INTEGER;

-- Create prep_recipe_procedure_steps table
CREATE TABLE IF NOT EXISTS public.prep_recipe_procedure_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prep_recipe_id UUID NOT NULL REFERENCES public.prep_recipes(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  instruction TEXT NOT NULL,
  timer_minutes INTEGER,
  critical_point BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(prep_recipe_id, step_number)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_prep_recipe_procedure_steps_recipe
  ON public.prep_recipe_procedure_steps(prep_recipe_id, step_number);

-- Updated-at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_prep_recipe_procedure_steps_updated_at'
  ) THEN
    CREATE TRIGGER update_prep_recipe_procedure_steps_updated_at
      BEFORE UPDATE ON public.prep_recipe_procedure_steps
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- RLS policies for procedure steps
ALTER TABLE public.prep_recipe_procedure_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "View prep recipe procedure steps" ON public.prep_recipe_procedure_steps;
DROP POLICY IF EXISTS "Create prep recipe procedure steps" ON public.prep_recipe_procedure_steps;
DROP POLICY IF EXISTS "Update prep recipe procedure steps" ON public.prep_recipe_procedure_steps;
DROP POLICY IF EXISTS "Delete prep recipe procedure steps" ON public.prep_recipe_procedure_steps;

CREATE POLICY "View prep recipe procedure steps"
  ON public.prep_recipe_procedure_steps FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_procedure_steps.prep_recipe_id
      AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Create prep recipe procedure steps"
  ON public.prep_recipe_procedure_steps FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_procedure_steps.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Update prep recipe procedure steps"
  ON public.prep_recipe_procedure_steps FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_procedure_steps.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_procedure_steps.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Delete prep recipe procedure steps"
  ON public.prep_recipe_procedure_steps FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_procedure_steps.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

-- Helper function to sync shelf life from recipe to output product
CREATE OR REPLACE FUNCTION public.sync_output_product_shelf_life()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shelf_life_days IS NOT NULL AND NEW.output_product_id IS NOT NULL THEN
    UPDATE products
    SET shelf_life_days = NEW.shelf_life_days,
        updated_at = now()
    WHERE id = NEW.output_product_id
      AND (shelf_life_days IS NULL OR shelf_life_days = 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_output_product_shelf_life_trigger ON public.prep_recipes;
CREATE TRIGGER sync_output_product_shelf_life_trigger
  AFTER INSERT OR UPDATE OF shelf_life_days, output_product_id
  ON public.prep_recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_output_product_shelf_life();

-- ============================================================
-- PART 2: Update Inventory Deduction for Production Runs
-- ============================================================

-- Drop old function signature to avoid ambiguity
DROP FUNCTION IF EXISTS public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text);

-- Recreate with new parameters for transaction type and reason prefix
-- This allows production runs to use 'transfer' (not COGS) vs POS using 'usage' (COGS)
CREATE OR REPLACE FUNCTION public.process_unified_inventory_deduction(
    p_restaurant_id uuid,
    p_pos_item_name text,
    p_quantity_sold integer,
    p_sale_date text,
    p_external_order_id text DEFAULT NULL::text,
    p_sale_time text DEFAULT NULL::text,
    p_restaurant_timezone text DEFAULT 'America/Chicago'::text,
    p_transaction_type text DEFAULT 'usage'::text,
    p_reason_prefix text DEFAULT 'POS sale'::text
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

    SELECT * INTO v_recipe_record
    FROM recipes
    WHERE restaurant_id = p_restaurant_id
      AND (pos_item_name = p_pos_item_name OR name = p_pos_item_name)
      AND is_active = true
    LIMIT 1;

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
               p.uom_purchase, p.uom_recipe, p.size_value, p.size_unit, p.id as product_id
        FROM recipe_ingredients ri
        JOIN products p ON ri.product_id = p.id
        WHERE ri.recipe_id = v_recipe_record.id
    LOOP
        v_deduction_amount := v_ingredient_record.quantity * p_quantity_sold;
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

        v_reason_text := format('%s: %s (Recipe: %s) [%s: %s %s → %s %s]',
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
            v_purchase_unit_lower
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

-- ============================================================
-- PART 3: Update complete_production_run to use 'transfer'
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_production_run(
  p_run_id UUID,
  p_actual_yield NUMERIC,
  p_actual_yield_unit public.measurement_unit,
  p_ingredients JSONB DEFAULT '[]'::jsonb
) RETURNS public.production_runs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run production_runs%ROWTYPE;
  v_prep prep_recipes%ROWTYPE;
  v_recipe recipes%ROWTYPE;
  v_user UUID := auth.uid();
  v_total_cost_snapshot NUMERIC := 0;
  v_output_inventory_impact NUMERIC := 0;
  v_reference_id TEXT;
  v_batch_multiplier NUMERIC;
  v_batch_multiplier_int INTEGER;
  v_sale_date TEXT;
  v_restaurant_timezone TEXT;
  v_actual_yield NUMERIC;
  v_actual_yield_unit public.measurement_unit;
  v_deduction_result JSONB;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_run FROM production_runs WHERE id = p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production run not found';
  END IF;

  SELECT * INTO v_prep FROM prep_recipes WHERE id = v_run.prep_recipe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prep recipe not found for run %', p_run_id;
  END IF;

  IF v_prep.recipe_id IS NULL THEN
    RAISE EXCEPTION 'Prep recipe % is missing linked recipe', v_prep.id;
  END IF;

  SELECT * INTO v_recipe FROM recipes WHERE id = v_prep.recipe_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe not found for prep recipe %', v_prep.id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = v_run.restaurant_id AND ur.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Not authorized for this restaurant';
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN v_run;
  END IF;

  v_actual_yield := COALESCE(p_actual_yield, v_run.actual_yield, v_run.target_yield, v_prep.default_yield, 0);
  v_actual_yield_unit := COALESCE(p_actual_yield_unit, v_run.actual_yield_unit, v_run.target_yield_unit, v_prep.default_yield_unit, 'unit');

  IF v_prep.default_yield IS NULL OR v_prep.default_yield <= 0 THEN
    RAISE EXCEPTION 'Prep recipe default yield is invalid for run %', p_run_id;
  END IF;

  v_batch_multiplier := v_actual_yield / v_prep.default_yield;

  IF v_batch_multiplier IS NULL OR v_batch_multiplier <= 0 THEN
    RAISE EXCEPTION 'Actual yield must be greater than zero for run %', p_run_id;
  END IF;

  IF v_batch_multiplier <> trunc(v_batch_multiplier) THEN
    RAISE EXCEPTION 'Actual yield must be a whole-number multiple of default yield (got % / %)', v_actual_yield, v_prep.default_yield;
  END IF;

  v_batch_multiplier_int := v_batch_multiplier::integer;

  SELECT timezone INTO v_restaurant_timezone FROM restaurants WHERE id = v_run.restaurant_id;
  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');
  v_sale_date := (now() AT TIME ZONE v_restaurant_timezone)::date::text;

  -- Use 'transfer' for production runs - not COGS until the product is sold
  v_deduction_result := public.process_unified_inventory_deduction(
    v_run.restaurant_id,
    v_recipe.name,
    v_batch_multiplier_int,
    v_sale_date,
    v_run.id::text,
    NULL,
    v_restaurant_timezone,
    'transfer',
    'Production'
  );

  v_reference_id := v_run.id::text || '_' || v_recipe.name || '_' || v_sale_date;

  UPDATE production_run_ingredients pri
  SET actual_quantity = COALESCE(
        (SELECT (ing_elem->>'actual_quantity')::numeric
         FROM jsonb_array_elements(p_ingredients) ing_elem
         WHERE ing_elem->>'product_id' = pri.product_id::text LIMIT 1),
        pri.actual_quantity, pri.expected_quantity, 0),
      unit = COALESCE(
        (SELECT (ing_elem->>'unit')::public.measurement_unit
         FROM jsonb_array_elements(p_ingredients) ing_elem
         WHERE ing_elem->>'product_id' = pri.product_id::text LIMIT 1),
        pri.unit),
      variance_percent = CASE
        WHEN pri.expected_quantity IS NOT NULL AND pri.expected_quantity <> 0 THEN
          ((COALESCE(
              (SELECT (ing_elem->>'actual_quantity')::numeric
               FROM jsonb_array_elements(p_ingredients) ing_elem
               WHERE ing_elem->>'product_id' = pri.product_id::text LIMIT 1),
              pri.actual_quantity, pri.expected_quantity, 0
            ) - pri.expected_quantity) / pri.expected_quantity) * 100
        ELSE NULL END,
      updated_at = now()
  WHERE pri.production_run_id = p_run_id;

  UPDATE production_run_ingredients pri
  SET unit_cost_snapshot = inv.unit_cost,
      total_cost_snapshot = ABS(inv.total_cost),
      updated_at = now()
  FROM inventory_transactions inv
  WHERE inv.reference_id = v_reference_id
    AND inv.transaction_type = 'transfer'
    AND inv.product_id = pri.product_id
    AND pri.production_run_id = p_run_id;

  SELECT COALESCE(SUM(ABS(total_cost)), 0) INTO v_total_cost_snapshot
  FROM inventory_transactions
  WHERE restaurant_id = v_run.restaurant_id
    AND reference_id = v_reference_id
    AND transaction_type = 'transfer';

  IF v_prep.output_product_id IS NOT NULL AND v_actual_yield IS NOT NULL THEN
    v_output_inventory_impact := public.calculate_inventory_impact_for_product(
      v_prep.output_product_id, v_actual_yield, v_actual_yield_unit::text, v_run.restaurant_id
    );
    v_output_inventory_impact := COALESCE(v_output_inventory_impact, v_actual_yield, 0);

    IF NOT EXISTS (
      SELECT 1 FROM inventory_transactions
      WHERE reference_id = v_reference_id AND transaction_type = 'transfer'
        AND product_id = v_prep.output_product_id AND quantity > 0
    ) THEN
      UPDATE products
      SET current_stock = COALESCE(current_stock, 0) + v_output_inventory_impact,
          cost_per_unit = CASE
            WHEN v_output_inventory_impact > 0 AND v_total_cost_snapshot > 0
              THEN v_total_cost_snapshot / v_output_inventory_impact
            ELSE cost_per_unit END,
          updated_at = now()
      WHERE id = v_prep.output_product_id;

      INSERT INTO inventory_transactions (
        restaurant_id, product_id, quantity, unit_cost, total_cost,
        transaction_type, reason, reference_id, performed_by
      ) VALUES (
        v_run.restaurant_id,
        v_prep.output_product_id,
        v_output_inventory_impact,
        CASE WHEN v_output_inventory_impact > 0 THEN v_total_cost_snapshot / v_output_inventory_impact ELSE 0 END,
        v_total_cost_snapshot,
        'transfer',
        'Production output ' || v_reference_id,
        v_reference_id,
        v_user
      );
    ELSE
      UPDATE products
      SET cost_per_unit = CASE
            WHEN v_output_inventory_impact > 0 AND v_total_cost_snapshot > 0
              THEN v_total_cost_snapshot / v_output_inventory_impact
            ELSE cost_per_unit END,
          updated_at = now()
      WHERE id = v_prep.output_product_id;
    END IF;
  END IF;

  UPDATE production_runs
  SET status = 'completed',
      actual_yield = v_actual_yield,
      actual_yield_unit = v_actual_yield_unit,
      variance_percent = CASE
        WHEN v_run.target_yield IS NOT NULL AND v_run.target_yield <> 0
          THEN ((v_actual_yield - v_run.target_yield) / v_run.target_yield) * 100
        ELSE NULL END,
      actual_total_cost = v_total_cost_snapshot,
      cost_per_unit = CASE
        WHEN v_actual_yield IS NOT NULL AND v_actual_yield <> 0
          THEN v_total_cost_snapshot / v_actual_yield
        ELSE NULL END,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

-- ============================================================
-- Documentation Comments
-- ============================================================

COMMENT ON TABLE public.prep_recipe_procedure_steps IS 'Step-by-step cooking instructions for prep recipes';
COMMENT ON COLUMN public.prep_recipes.category IS 'Recipe category: prep, sauces, proteins, dough, desserts, soup';
COMMENT ON COLUMN public.prep_recipes.shelf_life_days IS 'How many days the prepared output lasts';
COMMENT ON COLUMN public.prep_recipes.storage_instructions IS 'Storage method: refrigerate, freeze, room_temp';
COMMENT ON COLUMN public.prep_recipes.oven_temp IS 'Oven temperature if applicable';
COMMENT ON COLUMN public.prep_recipes.oven_temp_unit IS 'Temperature unit: F or C';
COMMENT ON COLUMN public.prep_recipes.equipment_notes IS 'Required equipment notes';
COMMENT ON COLUMN public.products.shelf_life_days IS 'Shelf life in days, auto-synced from prep recipe if applicable';

COMMENT ON FUNCTION public.process_unified_inventory_deduction(uuid, text, integer, text, text, text, text, text, text) IS
'Deducts ingredients from inventory based on a recipe.

Parameters:
- p_transaction_type: Controls how the deduction is categorized:
  - ''usage'' (default): For POS sales - counts toward COGS
  - ''transfer'': For production/prep - internal movement, not COGS until product is sold
- p_reason_prefix: Text prefix for the reason field (default: ''POS sale'')
  Use ''Production'' for prep runs.
';
