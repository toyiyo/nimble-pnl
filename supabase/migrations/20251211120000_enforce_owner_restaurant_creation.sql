-- Enforce owner-only restaurant creation at the database level
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required to create restaurants';
  END IF;

  -- Allow brand-new users with no restaurant associations to create their first restaurant
  -- Otherwise require an owner role either in user_restaurants or profiles
  IF EXISTS (SELECT 1 FROM public.user_restaurants ur WHERE ur.user_id = auth.uid()) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_restaurants ur
      WHERE ur.user_id = auth.uid()
        AND ur.role = 'owner'
    ) AND NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role = 'owner'
    ) THEN
      RAISE EXCEPTION 'Only owners can create restaurants';
    END IF;
  END IF;

  INSERT INTO public.restaurants (name, address, phone, cuisine_type, timezone)
  VALUES (restaurant_name, restaurant_address, restaurant_phone, restaurant_cuisine_type, restaurant_timezone)
  RETURNING id INTO new_restaurant_id;
  
  INSERT INTO public.user_restaurants (user_id, restaurant_id, role)
  VALUES (auth.uid(), new_restaurant_id, 'owner');
  
  RETURN new_restaurant_id;
END;
$$;

-- Restrict restaurant inserts to users with an owner role
DROP POLICY IF EXISTS "Users can insert restaurants if they're the owner" ON public.restaurants;

CREATE POLICY "Users can insert restaurants if they're the owner" 
ON public.restaurants 
FOR INSERT 
WITH CHECK (
  -- Allow first-time users with no associations
  NOT EXISTS (
    SELECT 1 FROM public.user_restaurants ur_check
    WHERE ur_check.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_restaurants ur
    WHERE ur.user_id = auth.uid()
      AND ur.role = 'owner'
  )
  OR EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.role = 'owner'
  )
);
