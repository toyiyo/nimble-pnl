-- Add index on recipe_ingredients.recipe_id for better query performance
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_recipe_id 
ON public.recipe_ingredients USING btree (recipe_id);