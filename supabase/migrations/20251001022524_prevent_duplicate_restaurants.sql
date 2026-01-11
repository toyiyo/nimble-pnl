-- Add deduplication and request serialization to restaurant creation
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
  existing_restaurant_id UUID;
BEGIN
  -- Serialize concurrent creations for the same user + restaurant name
  PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text || coalesce(restaurant_name, '')));

  -- If an identical restaurant was just created by this user, return it instead
  SELECT r.id INTO existing_restaurant_id
  FROM public.restaurants r
  JOIN public.user_restaurants ur ON ur.restaurant_id = r.id
  WHERE ur.user_id = auth.uid()
    AND lower(r.name) = lower(restaurant_name)
    AND r.created_at > now() - interval '5 seconds'
  ORDER BY r.created_at DESC
  LIMIT 1;

  IF existing_restaurant_id IS NOT NULL THEN
    RETURN existing_restaurant_id;
  END IF;

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
