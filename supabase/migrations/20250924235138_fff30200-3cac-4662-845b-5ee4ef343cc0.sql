-- Create enum for measurement units
CREATE TYPE public.measurement_unit AS ENUM (
  'oz', 'ml', 'cup', 'tbsp', 'tsp', 'lb', 'kg', 'g', 
  'bottle', 'can', 'bag', 'box', 'piece', 'serving'
);

-- Create recipes table
CREATE TABLE public.recipes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  pos_item_name TEXT, -- Name from POS system for mapping
  pos_item_id TEXT, -- ID from POS system if available
  serving_size NUMERIC DEFAULT 1,
  estimated_cost NUMERIC DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create recipe ingredients table
CREATE TABLE public.recipe_ingredients (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipe_id UUID NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC NOT NULL,
  unit public.measurement_unit NOT NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create conversion factors table for unit conversions
CREATE TABLE public.unit_conversions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  from_unit public.measurement_unit NOT NULL,
  to_unit public.measurement_unit NOT NULL,
  factor NUMERIC NOT NULL, -- multiply by this to convert from_unit to to_unit
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert common conversion factors
INSERT INTO public.unit_conversions (from_unit, to_unit, factor) VALUES
  ('oz', 'ml', 29.5735),
  ('ml', 'oz', 0.033814),
  ('cup', 'oz', 8),
  ('oz', 'cup', 0.125),
  ('tbsp', 'oz', 0.5),
  ('oz', 'tbsp', 2),
  ('tsp', 'oz', 0.166667),
  ('oz', 'tsp', 6),
  ('lb', 'oz', 16),
  ('oz', 'lb', 0.0625),
  ('kg', 'lb', 2.20462),
  ('lb', 'kg', 0.453592),
  ('g', 'oz', 0.035274),
  ('oz', 'g', 28.3495);

-- Create POS sales data table for tracking actual sales
CREATE TABLE public.pos_sales (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pos_item_name TEXT NOT NULL,
  pos_item_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  sale_price NUMERIC,
  sale_date DATE NOT NULL,
  sale_time TIME,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  raw_data JSONB -- Store original POS data
);

-- Enable RLS on all tables
ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_sales ENABLE ROW LEVEL SECURITY;

-- RLS policies for recipes
CREATE POLICY "Users can view recipes for their restaurants" 
ON public.recipes 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = recipes.restaurant_id 
  AND user_restaurants.user_id = auth.uid()
));

CREATE POLICY "Users can create recipes for their restaurants" 
ON public.recipes 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = recipes.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role IN ('owner', 'manager', 'chef')
));

CREATE POLICY "Users can update recipes for their restaurants" 
ON public.recipes 
FOR UPDATE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = recipes.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role IN ('owner', 'manager', 'chef')
));

CREATE POLICY "Users can delete recipes for their restaurants" 
ON public.recipes 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = recipes.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role IN ('owner', 'manager')
));

-- RLS policies for recipe ingredients
CREATE POLICY "Users can view recipe ingredients for their restaurants" 
ON public.recipe_ingredients 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM recipes r
  JOIN user_restaurants ur ON ur.restaurant_id = r.restaurant_id
  WHERE r.id = recipe_ingredients.recipe_id 
  AND ur.user_id = auth.uid()
));

CREATE POLICY "Users can manage recipe ingredients for their restaurants" 
ON public.recipe_ingredients 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM recipes r
  JOIN user_restaurants ur ON ur.restaurant_id = r.restaurant_id
  WHERE r.id = recipe_ingredients.recipe_id 
  AND ur.user_id = auth.uid() 
  AND ur.role IN ('owner', 'manager', 'chef')
));

-- RLS policies for unit conversions (public read-only)
CREATE POLICY "Anyone can view unit conversions" 
ON public.unit_conversions 
FOR SELECT 
USING (true);

-- RLS policies for POS sales
CREATE POLICY "Users can view POS sales for their restaurants" 
ON public.pos_sales 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = pos_sales.restaurant_id 
  AND user_restaurants.user_id = auth.uid()
));

CREATE POLICY "Users can insert POS sales for their restaurants" 
ON public.pos_sales 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = pos_sales.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role IN ('owner', 'manager')
));

-- Create triggers for updated_at
CREATE TRIGGER update_recipes_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_recipe_ingredients_updated_at
  BEFORE UPDATE ON public.recipe_ingredients
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to calculate recipe cost
CREATE OR REPLACE FUNCTION public.calculate_recipe_cost(recipe_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_cost NUMERIC := 0;
BEGIN
  SELECT COALESCE(SUM(
    ri.quantity * COALESCE(p.cost_per_unit, 0)
  ), 0) INTO total_cost
  FROM recipe_ingredients ri
  JOIN products p ON ri.product_id = p.id
  WHERE ri.recipe_id = calculate_recipe_cost.recipe_id;
  
  RETURN total_cost;
END;
$$;