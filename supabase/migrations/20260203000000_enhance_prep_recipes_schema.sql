-- Enhance prep recipes with additional fields and procedure steps
-- Also add shelf_life_days to products for inventory tracking

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

-- Updated-at trigger (only create if table was just created)
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

-- RLS policies (mirror prep_recipes access patterns)
ALTER TABLE public.prep_recipe_procedure_steps ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotency)
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

-- Helper function to update output product shelf life when recipe shelf life changes
CREATE OR REPLACE FUNCTION public.sync_output_product_shelf_life()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If recipe has shelf_life_days and output_product_id, sync it to the product
  -- Only update if product's shelf_life is null or 0 (don't override explicit values)
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

-- Trigger to auto-sync shelf life on recipe insert/update
DROP TRIGGER IF EXISTS sync_output_product_shelf_life_trigger ON public.prep_recipes;
CREATE TRIGGER sync_output_product_shelf_life_trigger
  AFTER INSERT OR UPDATE OF shelf_life_days, output_product_id
  ON public.prep_recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_output_product_shelf_life();

-- Comments for documentation
COMMENT ON TABLE public.prep_recipe_procedure_steps IS 'Step-by-step cooking instructions for prep recipes';
COMMENT ON COLUMN public.prep_recipes.category IS 'Recipe category: prep, sauces, proteins, dough, desserts, soup';
COMMENT ON COLUMN public.prep_recipes.shelf_life_days IS 'How many days the prepared output lasts';
COMMENT ON COLUMN public.prep_recipes.storage_instructions IS 'Storage method: refrigerate, freeze, room_temp';
COMMENT ON COLUMN public.prep_recipes.oven_temp IS 'Oven temperature if applicable';
COMMENT ON COLUMN public.prep_recipes.oven_temp_unit IS 'Temperature unit: F or C';
COMMENT ON COLUMN public.prep_recipes.equipment_notes IS 'Required equipment notes';
COMMENT ON COLUMN public.products.shelf_life_days IS 'Shelf life in days, auto-synced from prep recipe if applicable';
