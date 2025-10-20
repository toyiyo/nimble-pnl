-- Add index on recipe_ingredients.product_id for better query performance
CREATE INDEX IF NOT EXISTS idx_recipe_ingredients_product_id 
ON public.recipe_ingredients USING btree (product_id);