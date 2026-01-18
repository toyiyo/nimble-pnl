-- Use unified recipe deduction logic for prep production runs

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

  SELECT timezone INTO v_restaurant_timezone
  FROM restaurants
  WHERE id = v_run.restaurant_id;

  v_restaurant_timezone := COALESCE(v_restaurant_timezone, 'America/Chicago');
  v_sale_date := (now() AT TIME ZONE v_restaurant_timezone)::date::text;

  v_deduction_result := public.process_unified_inventory_deduction(
    v_run.restaurant_id,
    v_recipe.name,
    v_batch_multiplier_int,
    v_sale_date,
    v_run.id::text,
    NULL,
    v_restaurant_timezone
  );

  v_reference_id := v_run.id::text || '_' || v_recipe.name || '_' || v_sale_date;

  UPDATE production_run_ingredients pri
  SET actual_quantity = COALESCE(
        (
          SELECT (ing_elem->>'actual_quantity')::numeric
          FROM jsonb_array_elements(p_ingredients) ing_elem
          WHERE ing_elem->>'product_id' = pri.product_id::text
          LIMIT 1
        ),
        pri.actual_quantity,
        pri.expected_quantity,
        0
      ),
      unit = COALESCE(
        (
          SELECT (ing_elem->>'unit')::public.measurement_unit
          FROM jsonb_array_elements(p_ingredients) ing_elem
          WHERE ing_elem->>'product_id' = pri.product_id::text
          LIMIT 1
        ),
        pri.unit
      ),
      variance_percent = CASE
        WHEN pri.expected_quantity IS NOT NULL AND pri.expected_quantity <> 0 THEN
          (
            (
              COALESCE(
                (
                  SELECT (ing_elem->>'actual_quantity')::numeric
                  FROM jsonb_array_elements(p_ingredients) ing_elem
                  WHERE ing_elem->>'product_id' = pri.product_id::text
                  LIMIT 1
                ),
                pri.actual_quantity,
                pri.expected_quantity,
                0
              ) - pri.expected_quantity
            ) / pri.expected_quantity
          ) * 100
        ELSE NULL
      END,
      updated_at = now()
  WHERE pri.production_run_id = p_run_id;

  UPDATE production_run_ingredients pri
  SET unit_cost_snapshot = inv.unit_cost,
      total_cost_snapshot = ABS(inv.total_cost),
      updated_at = now()
  FROM inventory_transactions inv
  WHERE inv.reference_id = v_reference_id
    AND inv.transaction_type = 'usage'
    AND inv.product_id = pri.product_id
    AND pri.production_run_id = p_run_id;

  SELECT COALESCE(SUM(ABS(total_cost)), 0)
  INTO v_total_cost_snapshot
  FROM inventory_transactions
  WHERE restaurant_id = v_run.restaurant_id
    AND reference_id = v_reference_id
    AND transaction_type = 'usage';

  IF v_prep.output_product_id IS NOT NULL AND v_actual_yield IS NOT NULL THEN
    v_output_inventory_impact := public.calculate_inventory_impact_for_product(
      v_prep.output_product_id,
      v_actual_yield,
      v_actual_yield_unit::text,
      v_run.restaurant_id
    );

    v_output_inventory_impact := COALESCE(v_output_inventory_impact, v_actual_yield, 0);

    IF NOT EXISTS (
      SELECT 1
      FROM inventory_transactions
      WHERE reference_id = v_reference_id
        AND transaction_type = 'transfer'
        AND product_id = v_prep.output_product_id
        AND quantity > 0
    ) THEN
      UPDATE products
      SET current_stock = COALESCE(current_stock, 0) + v_output_inventory_impact,
          cost_per_unit = CASE
            WHEN v_output_inventory_impact > 0 AND v_total_cost_snapshot > 0
              THEN v_total_cost_snapshot / v_output_inventory_impact
            ELSE cost_per_unit
          END,
          updated_at = now()
      WHERE id = v_prep.output_product_id;

      INSERT INTO inventory_transactions (
        restaurant_id,
        product_id,
        quantity,
        unit_cost,
        total_cost,
        transaction_type,
        reason,
        reference_id,
        performed_by
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
            ELSE cost_per_unit
          END,
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
        ELSE NULL
      END,
      actual_total_cost = v_total_cost_snapshot,
      cost_per_unit = CASE
        WHEN v_actual_yield IS NOT NULL AND v_actual_yield <> 0 THEN v_total_cost_snapshot / v_actual_yield
        ELSE NULL END,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;
