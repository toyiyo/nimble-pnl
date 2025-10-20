-- Add index on recipes.name for better query performance
CREATE INDEX IF NOT EXISTS idx_recipes_name 
ON public.recipes USING btree (name);