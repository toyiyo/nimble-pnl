-- Centralize inventory unit conversion and reuse in production runs
CREATE OR REPLACE FUNCTION public.calculate_inventory_impact_for_product(
  p_product_id UUID,
  p_recipe_quantity NUMERIC,
  p_recipe_unit TEXT
) RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_recipe_unit_lower TEXT := LOWER(TRIM(p_recipe_unit));
  v_purchase_unit_lower TEXT;
  v_size_unit_lower TEXT;
  v_inventory_impact NUMERIC := p_recipe_quantity;
  v_recipe_in_ml NUMERIC;
  v_size_in_ml NUMERIC;
  v_recipe_in_g NUMERIC;
  v_size_in_g NUMERIC;
BEGIN
  SELECT uom_purchase, size_value, size_unit, name
  INTO v_product
  FROM products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN p_recipe_quantity;
  END IF;

  v_purchase_unit_lower := LOWER(TRIM(COALESCE(v_product.uom_purchase, v_recipe_unit_lower)));
  v_size_unit_lower := LOWER(TRIM(COALESCE(v_product.size_unit, '')));

  -- 1:1 match
  IF v_recipe_unit_lower = v_purchase_unit_lower THEN
    RETURN p_recipe_quantity;
  END IF;

  -- Container units with size conversions
  IF v_purchase_unit_lower IN ('bottle','jar','can','bag','box','case','package','container') THEN
    IF v_product.size_value IS NOT NULL AND v_product.size_unit IS NOT NULL THEN
      -- Volume context (treat oz as fluid ounces when size_unit is volume)
      IF v_size_unit_lower IN ('gal','l','ml','qt','pint','cup','fl oz') AND v_recipe_unit_lower IN ('fl oz','oz','ml','l','cup','tbsp','tsp','gal','qt','pint') THEN
        v_recipe_in_ml := CASE v_recipe_unit_lower
          WHEN 'fl oz' THEN p_recipe_quantity * 29.5735
          WHEN 'oz' THEN p_recipe_quantity * 29.5735
          WHEN 'ml' THEN p_recipe_quantity
          WHEN 'l' THEN p_recipe_quantity * 1000
          WHEN 'cup' THEN p_recipe_quantity * 236.588
          WHEN 'tbsp' THEN p_recipe_quantity * 14.7868
          WHEN 'tsp' THEN p_recipe_quantity * 4.92892
          WHEN 'gal' THEN p_recipe_quantity * 3785.41
          WHEN 'qt' THEN p_recipe_quantity * 946.353
          WHEN 'pint' THEN p_recipe_quantity * 473.176
          ELSE p_recipe_quantity
        END;

        v_size_in_ml := CASE v_size_unit_lower
          WHEN 'ml' THEN v_product.size_value
          WHEN 'l' THEN v_product.size_value * 1000
          WHEN 'gal' THEN v_product.size_value * 3785.41
          WHEN 'qt' THEN v_product.size_value * 946.353
          WHEN 'pint' THEN v_product.size_value * 473.176
          WHEN 'cup' THEN v_product.size_value * 236.588
          WHEN 'fl oz' THEN v_product.size_value * 29.5735
          ELSE v_product.size_value
        END;

        IF v_size_in_ml > 0 THEN
          RETURN v_recipe_in_ml / v_size_in_ml;
        END IF;

      -- Weight context
      ELSIF v_size_unit_lower IN ('kg','g','lb','oz') AND v_recipe_unit_lower IN ('kg','g','lb','oz','cup') THEN
        v_recipe_in_g := CASE v_recipe_unit_lower
          WHEN 'kg' THEN p_recipe_quantity * 1000
          WHEN 'g' THEN p_recipe_quantity
          WHEN 'lb' THEN p_recipe_quantity * 453.592
          WHEN 'oz' THEN p_recipe_quantity * 28.3495
          WHEN 'cup' THEN
            CASE
              WHEN LOWER(v_product.name) LIKE '%rice%' THEN p_recipe_quantity * 185
              WHEN LOWER(v_product.name) LIKE '%flour%' THEN p_recipe_quantity * 120
              WHEN LOWER(v_product.name) LIKE '%sugar%' THEN p_recipe_quantity * 200
              WHEN LOWER(v_product.name) LIKE '%butter%' THEN p_recipe_quantity * 227
              ELSE NULL
            END
          ELSE p_recipe_quantity
        END;

        v_size_in_g := CASE v_size_unit_lower
          WHEN 'kg' THEN v_product.size_value * 1000
          WHEN 'g' THEN v_product.size_value
          WHEN 'lb' THEN v_product.size_value * 453.592
          WHEN 'oz' THEN v_product.size_value * 28.3495
          ELSE v_product.size_value
        END;

        IF v_size_in_g > 0 AND v_recipe_in_g IS NOT NULL THEN
          RETURN v_recipe_in_g / v_size_in_g;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Standard volume-to-volume (non-container) conversion
  IF v_purchase_unit_lower IN ('fl oz','oz','ml','l','gal','qt','pint','cup','tbsp','tsp')
    AND v_recipe_unit_lower IN ('fl oz','oz','ml','l','gal','qt','pint','cup','tbsp','tsp') THEN

    v_recipe_in_ml := CASE v_recipe_unit_lower
      WHEN 'fl oz' THEN p_recipe_quantity * 29.5735
      WHEN 'oz' THEN p_recipe_quantity * 29.5735
      WHEN 'ml' THEN p_recipe_quantity
      WHEN 'l' THEN p_recipe_quantity * 1000
      WHEN 'gal' THEN p_recipe_quantity * 3785.41
      WHEN 'qt' THEN p_recipe_quantity * 946.353
      WHEN 'pint' THEN p_recipe_quantity * 473.176
      WHEN 'cup' THEN p_recipe_quantity * 236.588
      WHEN 'tbsp' THEN p_recipe_quantity * 14.7868
      WHEN 'tsp' THEN p_recipe_quantity * 4.92892
      ELSE p_recipe_quantity
    END;

    v_size_in_ml := CASE v_purchase_unit_lower
      WHEN 'ml' THEN 1
      WHEN 'l' THEN 1000
      WHEN 'fl oz' THEN 29.5735
      WHEN 'oz' THEN 29.5735
      WHEN 'gal' THEN 3785.41
      WHEN 'qt' THEN 946.353
      WHEN 'pint' THEN 473.176
      WHEN 'cup' THEN 236.588
      WHEN 'tbsp' THEN 14.7868
      WHEN 'tsp' THEN 4.92892
      ELSE 1
    END;

    IF v_size_in_ml > 0 THEN
      RETURN v_recipe_in_ml / v_size_in_ml;
    END IF;
  END IF;

  -- Standard weight-to-weight (non-container) conversion
  IF v_purchase_unit_lower IN ('g','kg','lb','oz')
    AND v_recipe_unit_lower IN ('g','kg','lb','oz') THEN

    v_recipe_in_g := CASE v_recipe_unit_lower
      WHEN 'kg' THEN p_recipe_quantity * 1000
      WHEN 'g' THEN p_recipe_quantity
      WHEN 'lb' THEN p_recipe_quantity * 453.592
      WHEN 'oz' THEN p_recipe_quantity * 28.3495
      ELSE p_recipe_quantity
    END;

    v_size_in_g := CASE v_purchase_unit_lower
      WHEN 'kg' THEN 1000
      WHEN 'g' THEN 1
      WHEN 'lb' THEN 453.592
      WHEN 'oz' THEN 28.3495
      ELSE 1
    END;

    IF v_size_in_g > 0 THEN
      RETURN v_recipe_in_g / v_size_in_g;
    END IF;
  END IF;

  -- Fallback: use raw quantity
  RETURN p_recipe_quantity;
END;
$$;

COMMENT ON FUNCTION public.calculate_inventory_impact_for_product IS 'Convert recipe quantity/unit to purchase/container units for inventory movement';

-- Recreate complete_production_run to use the shared converter
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
      v_unit::text
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
    UPDATE products
    SET current_stock = COALESCE(current_stock, 0) + p_actual_yield,
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
      p_actual_yield,
      CASE WHEN p_actual_yield > 0 THEN v_total_cost_snapshot / p_actual_yield ELSE 0 END,
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

GRANT EXECUTE ON FUNCTION public.calculate_inventory_impact_for_product(UUID, NUMERIC, TEXT) TO authenticated;
