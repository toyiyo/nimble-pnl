-- Update complete_production_run to set output product cost_per_unit using batch cost
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
  v_recipe prep_recipes%ROWTYPE;
  v_user UUID := auth.uid();
  v_total_cost NUMERIC := 0;
  v_ing RECORD;
  v_actual NUMERIC;
  v_unit public.measurement_unit;
  v_unit_cost NUMERIC;
  v_current_stock NUMERIC;
  v_reference TEXT;
  v_total_cost_snapshot NUMERIC := 0;
  v_inventory_impact NUMERIC;
  v_output_inventory_impact NUMERIC;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_run FROM production_runs WHERE id = p_run_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found'; END IF;

  SELECT * INTO v_recipe FROM prep_recipes WHERE id = v_run.prep_recipe_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Prep recipe not found for run %', p_run_id; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_restaurants ur
    WHERE ur.restaurant_id = v_run.restaurant_id AND ur.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Not authorized for this restaurant';
  END IF;

  IF v_run.status = 'completed' THEN
    RETURN v_run;
  END IF;

  v_reference := COALESCE(v_run.id::text, 'production_run');

  FOR v_ing IN
    SELECT pri.*, p.cost_per_unit, p.current_stock, p.name AS product_name, p.uom_purchase, p.size_value, p.size_unit
    FROM production_run_ingredients pri
    JOIN products p ON p.id = pri.product_id
    WHERE pri.production_run_id = p_run_id
  LOOP
    v_actual := COALESCE(
      (
        SELECT (ing_elem->>'actual_quantity')::NUMERIC
        FROM jsonb_array_elements(p_ingredients) ing_elem
        WHERE ing_elem->>'product_id' = v_ing.product_id::text
        LIMIT 1
      ),
      v_ing.actual_quantity,
      v_ing.expected_quantity,
      0
    );

    v_unit := COALESCE(
      (
        SELECT (ing_elem->>'unit')::public.measurement_unit
        FROM jsonb_array_elements(p_ingredients) ing_elem
        WHERE ing_elem->>'product_id' = v_ing.product_id::text
        LIMIT 1
      ),
      v_ing.unit
    );

    v_inventory_impact := public.calculate_inventory_impact_for_product(
      v_ing.product_id,
      v_actual,
      v_unit::text,
      v_run.restaurant_id
    );

    UPDATE products
    SET current_stock = COALESCE(current_stock, 0) - v_inventory_impact,
        updated_at = now()
    WHERE id = v_ing.product_id
    RETURNING current_stock, cost_per_unit INTO v_current_stock, v_unit_cost;

    UPDATE production_run_ingredients
    SET actual_quantity = v_actual,
        unit = v_unit,
        variance_percent = CASE
          WHEN v_ing.expected_quantity IS NOT NULL AND v_ing.expected_quantity <> 0
            THEN ((v_actual - v_ing.expected_quantity) / v_ing.expected_quantity) * 100
          ELSE NULL
        END,
        unit_cost_snapshot = v_unit_cost,
        total_cost_snapshot = COALESCE(v_unit_cost, 0) * v_inventory_impact,
        updated_at = now()
    WHERE id = v_ing.id;

    v_total_cost_snapshot := v_total_cost_snapshot + COALESCE(v_unit_cost, 0) * v_inventory_impact;
    v_total_cost := v_total_cost + COALESCE(v_unit_cost, 0) * v_inventory_impact;

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
      v_ing.product_id,
      -v_inventory_impact,
      v_unit_cost,
      COALESCE(v_unit_cost, 0) * -v_inventory_impact,
      'transfer',
      'Production run (ingredient) ' || v_reference,
      v_reference,
      v_user
    );
  END LOOP;

  p_actual_yield := COALESCE(p_actual_yield, v_run.actual_yield, v_run.target_yield, 0);
  p_actual_yield_unit := COALESCE(p_actual_yield_unit, v_run.actual_yield_unit, v_run.target_yield_unit, 'unit');

  IF v_recipe.output_product_id IS NOT NULL AND p_actual_yield IS NOT NULL THEN
    v_output_inventory_impact := public.calculate_inventory_impact_for_product(
      v_recipe.output_product_id,
      p_actual_yield,
      p_actual_yield_unit::text,
      v_run.restaurant_id
    );

    v_output_inventory_impact := COALESCE(v_output_inventory_impact, p_actual_yield, 0);

    UPDATE products
    SET current_stock = COALESCE(current_stock, 0) + v_output_inventory_impact,
        cost_per_unit = CASE
          WHEN v_output_inventory_impact > 0 AND v_total_cost_snapshot > 0
            THEN v_total_cost_snapshot / v_output_inventory_impact
          ELSE cost_per_unit
        END,
        updated_at = now()
    WHERE id = v_recipe.output_product_id;

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
      v_recipe.output_product_id,
      v_output_inventory_impact,
      CASE WHEN v_output_inventory_impact > 0 THEN v_total_cost_snapshot / v_output_inventory_impact ELSE 0 END,
      v_total_cost_snapshot,
      'transfer',
      'Production output ' || v_reference,
      v_reference,
      v_user
    );
  END IF;

  UPDATE production_runs
  SET status = 'completed',
      actual_yield = p_actual_yield,
      actual_yield_unit = p_actual_yield_unit,
      variance_percent = CASE
        WHEN v_run.target_yield IS NOT NULL AND v_run.target_yield <> 0
          THEN ((COALESCE(p_actual_yield, 0) - v_run.target_yield) / v_run.target_yield) * 100
        ELSE NULL
      END,
      actual_total_cost = v_total_cost_snapshot,
      cost_per_unit = CASE
        WHEN p_actual_yield IS NOT NULL AND p_actual_yield <> 0 THEN v_total_cost_snapshot / p_actual_yield
        ELSE NULL END,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_run_id
  RETURNING * INTO v_run;

  RETURN v_run;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_production_run(UUID, NUMERIC, public.measurement_unit, JSONB) TO authenticated;
