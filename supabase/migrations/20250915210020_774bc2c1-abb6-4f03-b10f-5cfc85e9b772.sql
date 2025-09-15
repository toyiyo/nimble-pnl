-- Create restaurants table
CREATE TABLE public.restaurants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  cuisine_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_restaurants junction table for many-to-many relationship
CREATE TABLE public.user_restaurants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  role TEXT CHECK (role IN ('owner', 'manager', 'chef', 'staff')) DEFAULT 'staff',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, restaurant_id)
);

-- Enable Row Level Security
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_restaurants ENABLE ROW LEVEL SECURITY;

-- Create policies for restaurants
CREATE POLICY "Users can view restaurants they're associated with" 
ON public.restaurants 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = restaurants.id 
    AND user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert restaurants if they're the owner" 
ON public.restaurants 
FOR INSERT 
WITH CHECK (true); -- Will be controlled by user_restaurants insert

CREATE POLICY "Owners and managers can update their restaurants" 
ON public.restaurants 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants 
    WHERE restaurant_id = restaurants.id 
    AND user_id = auth.uid() 
    AND role IN ('owner', 'manager')
  )
);

-- Create policies for user_restaurants
CREATE POLICY "Users can view their restaurant associations" 
ON public.user_restaurants 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own restaurant associations" 
ON public.user_restaurants 
FOR INSERT 
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Owners can manage restaurant associations" 
ON public.user_restaurants 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.user_restaurants ur 
    WHERE ur.restaurant_id = user_restaurants.restaurant_id 
    AND ur.user_id = auth.uid() 
    AND ur.role = 'owner'
  )
);

-- Add triggers for updated_at
CREATE TRIGGER update_restaurants_updated_at
BEFORE UPDATE ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to create restaurant with owner relationship
CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(
  restaurant_name TEXT,
  restaurant_address TEXT DEFAULT NULL,
  restaurant_phone TEXT DEFAULT NULL,
  restaurant_cuisine_type TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_restaurant_id UUID;
BEGIN
  -- Insert restaurant
  INSERT INTO public.restaurants (name, address, phone, cuisine_type)
  VALUES (restaurant_name, restaurant_address, restaurant_phone, restaurant_cuisine_type)
  RETURNING id INTO new_restaurant_id;
  
  -- Associate user as owner
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
  VALUES (auth.uid(), new_restaurant_id, 'owner');
  
  RETURN new_restaurant_id;
END;
$$;