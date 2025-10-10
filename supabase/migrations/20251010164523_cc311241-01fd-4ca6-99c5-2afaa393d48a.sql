-- Drop the unused calculate_recipe_cost function
-- This function is not being used anywhere in the application
-- Recipe costs are calculated on the frontend instead
DROP FUNCTION IF EXISTS public.calculate_recipe_cost(uuid);