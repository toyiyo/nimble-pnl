-- Create inventory_locations table for managing storage locations per restaurant
CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure unique location names per restaurant
  UNIQUE(restaurant_id, name)
);

-- Enable RLS
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;

-- Create policies for inventory_locations
CREATE POLICY "Users can view locations for their restaurants" 
ON public.inventory_locations 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = inventory_locations.restaurant_id 
  AND user_restaurants.user_id = auth.uid()
));

CREATE POLICY "Users can insert locations for their restaurants" 
ON public.inventory_locations 
FOR INSERT 
WITH CHECK (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = inventory_locations.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager', 'chef', 'staff'])
));

CREATE POLICY "Users can delete locations for their restaurants" 
ON public.inventory_locations 
FOR DELETE 
USING (EXISTS (
  SELECT 1 FROM user_restaurants 
  WHERE user_restaurants.restaurant_id = inventory_locations.restaurant_id 
  AND user_restaurants.user_id = auth.uid() 
  AND user_restaurants.role = ANY(ARRAY['owner', 'manager'])
));

-- Create indexes for better performance
CREATE INDEX idx_inventory_locations_restaurant_id ON public.inventory_locations(restaurant_id);
CREATE INDEX idx_inventory_locations_name ON public.inventory_locations(restaurant_id, name);

-- Insert default locations for existing restaurants
INSERT INTO public.inventory_locations (restaurant_id, name)
SELECT DISTINCT r.id, loc.name
FROM public.restaurants r
CROSS JOIN (
  VALUES 
    ('Main Kitchen'),
    ('Prep Area'),
    ('Walk-in Cooler'),
    ('Walk-in Freezer'),
    ('Dry Storage'),
    ('Bar Area'),
    ('Front of House'),
    ('Backup Storage')
) AS loc(name)
ON CONFLICT (restaurant_id, name) DO NOTHING;
