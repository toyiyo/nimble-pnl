-- Atomic ingredient updates for prep recipes
CREATE OR REPLACE FUNCTION public.update_prep_recipe_ingredients(
  p_prep_recipe_id uuid,
  p_ingredients jsonb DEFAULT '[]'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant_id uuid;
BEGIN
  SELECT restaurant_id
  INTO v_restaurant_id
  FROM prep_recipes
  WHERE id = p_prep_recipe_id;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Prep recipe not found';
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Missing auth context';
  END IF;

  -- Enforce same permissions as direct table updates
  IF NOT EXISTS (
    SELECT 1
    FROM user_restaurants ur
    WHERE ur.restaurant_id = v_restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner', 'manager', 'chef')
  ) THEN
    RAISE EXCEPTION 'Permission denied: cannot modify ingredients for this recipe';
  END IF;

  p_ingredients := COALESCE(p_ingredients, '[]'::jsonb);

  -- Replace all ingredients in a single transaction to avoid partial writes
  DELETE FROM prep_recipe_ingredients
  WHERE prep_recipe_id = p_prep_recipe_id;

  INSERT INTO prep_recipe_ingredients (prep_recipe_id, product_id, quantity, unit, notes, sort_order)
  SELECT
    p_prep_recipe_id,
    (ing->>'product_id')::uuid,
    (ing->>'quantity')::numeric,
    (ing->>'unit')::measurement_unit,
    NULLIF(ing->>'notes', ''),
    COALESCE((ing->>'sort_order')::integer, ordinality - 1)
  FROM jsonb_array_elements(p_ingredients) WITH ORDINALITY AS t(ing, ordinality)
  WHERE ing ? 'product_id' AND ing->>'product_id' IS NOT NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_prep_recipe_ingredients(uuid, jsonb) TO authenticated;
