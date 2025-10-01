-- Update create_restaurant_with_owner function to accept timezone parameter
CREATE OR REPLACE FUNCTION public.create_restaurant_with_owner(
  restaurant_name text, 
  restaurant_address text DEFAULT NULL::text, 
  restaurant_phone text DEFAULT NULL::text, 
  restaurant_cuisine_type text DEFAULT NULL::text,
  restaurant_timezone text DEFAULT 'America/Chicago'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_restaurant_id UUID;
BEGIN
  -- Insert restaurant with timezone
  INSERT INTO public.restaurants (name, address, phone, cuisine_type, timezone)
  VALUES (restaurant_name, restaurant_address, restaurant_phone, restaurant_cuisine_type, restaurant_timezone)
  RETURNING id INTO new_restaurant_id;
  
  -- Link restaurant to current user as owner
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
  VALUES (auth.uid(), new_restaurant_id, 'owner');
  
  RETURN new_restaurant_id;
END;
$$;