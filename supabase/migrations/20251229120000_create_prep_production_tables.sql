-- Prep production schema: recipes (blueprints) and production runs (batches)
DO $$ BEGIN
  CREATE TYPE public.production_run_status AS ENUM ('planned', 'in_progress', 'completed', 'cancelled', 'draft');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE public.prep_recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  output_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  default_yield NUMERIC NOT NULL DEFAULT 1,
  default_yield_unit public.measurement_unit NOT NULL DEFAULT 'unit',
  prep_time_minutes INTEGER,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.prep_recipe_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prep_recipe_id UUID NOT NULL REFERENCES public.prep_recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  unit public.measurement_unit NOT NULL,
  notes TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.production_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  prep_recipe_id UUID NOT NULL REFERENCES public.prep_recipes(id) ON DELETE CASCADE,
  status public.production_run_status NOT NULL DEFAULT 'planned',
  target_yield NUMERIC,
  target_yield_unit public.measurement_unit,
  actual_yield NUMERIC,
  actual_yield_unit public.measurement_unit,
  variance_percent NUMERIC,
  expected_total_cost NUMERIC,
  actual_total_cost NUMERIC,
  cost_per_unit NUMERIC,
  scheduled_for TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  prepared_by UUID REFERENCES auth.users(id),
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE public.production_run_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  production_run_id UUID NOT NULL REFERENCES public.production_runs(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  expected_quantity NUMERIC,
  actual_quantity NUMERIC,
  unit public.measurement_unit,
  variance_percent NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes to keep lookups fast
CREATE INDEX idx_prep_recipes_restaurant ON public.prep_recipes(restaurant_id);
CREATE INDEX idx_prep_recipes_output_product ON public.prep_recipes(output_product_id);
CREATE INDEX idx_prep_recipe_ingredients_recipe ON public.prep_recipe_ingredients(prep_recipe_id);
CREATE INDEX idx_production_runs_restaurant_status ON public.production_runs(restaurant_id, status);
CREATE INDEX idx_production_runs_recipe ON public.production_runs(prep_recipe_id);
CREATE INDEX idx_production_run_ingredients_run ON public.production_run_ingredients(production_run_id);

-- Updated-at triggers
CREATE TRIGGER update_prep_recipes_updated_at
  BEFORE UPDATE ON public.prep_recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_prep_recipe_ingredients_updated_at
  BEFORE UPDATE ON public.prep_recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_production_runs_updated_at
  BEFORE UPDATE ON public.production_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_production_run_ingredients_updated_at
  BEFORE UPDATE ON public.production_run_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS setup
ALTER TABLE public.prep_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prep_recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_run_ingredients ENABLE ROW LEVEL SECURITY;

-- Prep recipes policies (manager/chef controls, staff view)
CREATE POLICY "View prep recipes for restaurant"
  ON public.prep_recipes
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = prep_recipes.restaurant_id
      AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Create prep recipes for restaurant"
  ON public.prep_recipes
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = prep_recipes.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Update prep recipes for restaurant"
  ON public.prep_recipes
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = prep_recipes.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = prep_recipes.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Delete prep recipes for restaurant"
  ON public.prep_recipes
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = prep_recipes.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager')
  ));

-- Prep recipe ingredients policies mirror parent recipe
CREATE POLICY "View prep recipe ingredients"
  ON public.prep_recipe_ingredients
  FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_ingredients.prep_recipe_id
      AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Create prep recipe ingredients"
  ON public.prep_recipe_ingredients
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_ingredients.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Update prep recipe ingredients"
  ON public.prep_recipe_ingredients
  FOR UPDATE
  USING (EXISTS (
    SELECT 1
    FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_ingredients.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_ingredients.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

CREATE POLICY "Delete prep recipe ingredients"
  ON public.prep_recipe_ingredients
  FOR DELETE
  USING (EXISTS (
    SELECT 1
    FROM public.prep_recipes pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = prep_recipe_ingredients.prep_recipe_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

-- Production run policies (kitchen staff can create/update)
CREATE POLICY "View production runs for restaurant"
  ON public.production_runs
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = production_runs.restaurant_id
      AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Create production runs for restaurant"
  ON public.production_runs
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = production_runs.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ));

CREATE POLICY "Update production runs for restaurant"
  ON public.production_runs
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = production_runs.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = production_runs.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ));

CREATE POLICY "Delete production runs for restaurant"
  ON public.production_runs
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.restaurant_id = production_runs.restaurant_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef')
  ));

-- Production run ingredients policies mirror parent run
CREATE POLICY "View production run ingredients"
  ON public.production_run_ingredients
  FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.production_runs pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = production_run_ingredients.production_run_id
      AND ur.user_id = auth.uid()
  ));

CREATE POLICY "Create production run ingredients"
  ON public.production_run_ingredients
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.production_runs pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = production_run_ingredients.production_run_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ));

CREATE POLICY "Update production run ingredients"
  ON public.production_run_ingredients
  FOR UPDATE
  USING (EXISTS (
    SELECT 1
    FROM public.production_runs pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = production_run_ingredients.production_run_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.production_runs pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = production_run_ingredients.production_run_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ));

CREATE POLICY "Delete production run ingredients"
  ON public.production_run_ingredients
  FOR DELETE
  USING (EXISTS (
    SELECT 1
    FROM public.production_runs pr
    JOIN public.user_restaurants ur ON ur.restaurant_id = pr.restaurant_id
    WHERE pr.id = production_run_ingredients.production_run_id
      AND ur.user_id = auth.uid()
      AND ur.role IN ('owner','manager','chef','staff')
  ));
