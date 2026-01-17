-- Link prep recipes to recipes for unified inventory deductions

ALTER TABLE public.prep_recipes
  ADD COLUMN recipe_id UUID REFERENCES public.recipes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_prep_recipes_recipe_id ON public.prep_recipes(recipe_id);

WITH to_insert AS (
  SELECT
    pr.id AS prep_recipe_id,
    gen_random_uuid() AS recipe_id,
    pr.restaurant_id,
    pr.name,
    pr.description,
    COALESCE(pr.default_yield, 1) AS serving_size,
    pr.created_at,
    pr.updated_at,
    pr.created_by
  FROM public.prep_recipes pr
  WHERE pr.recipe_id IS NULL
), inserted_recipes AS (
  INSERT INTO public.recipes (
    id,
    restaurant_id,
    name,
    description,
    serving_size,
    estimated_cost,
    is_active,
    created_at,
    updated_at,
    created_by
  )
  SELECT
    recipe_id,
    restaurant_id,
    name,
    description,
    serving_size,
    0,
    true,
    created_at,
    updated_at,
    created_by
  FROM to_insert
), updated_prep AS (
  UPDATE public.prep_recipes pr
  SET recipe_id = ti.recipe_id
  FROM to_insert ti
  WHERE pr.id = ti.prep_recipe_id
  RETURNING pr.id
)
INSERT INTO public.recipe_ingredients (
  recipe_id,
  product_id,
  quantity,
  unit,
  notes,
  created_at,
  updated_at
)
SELECT
  ti.recipe_id,
  pri.product_id,
  pri.quantity,
  pri.unit,
  pri.notes,
  pri.created_at,
  pri.updated_at
FROM public.prep_recipe_ingredients pri
JOIN to_insert ti ON ti.prep_recipe_id = pri.prep_recipe_id;
