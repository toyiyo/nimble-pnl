-- Create security definer function to check if user is owner of a restaurant
CREATE OR REPLACE FUNCTION public.is_restaurant_owner(p_restaurant_id uuid, p_user_id uuid)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM public.user_restaurants 
    WHERE restaurant_id = p_restaurant_id 
      AND user_id = p_user_id 
      AND role = 'owner'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public;

-- Drop the problematic policy
DROP POLICY IF EXISTS "Owners can manage restaurant associations" ON public.user_restaurants;

-- Create new policies without recursion
CREATE POLICY "Owners can manage restaurant associations" 
ON public.user_restaurants 
FOR ALL
USING (
  user_id = auth.uid() OR 
  public.is_restaurant_owner(restaurant_id, auth.uid())
)
WITH CHECK (
  user_id = auth.uid() OR 
  public.is_restaurant_owner(restaurant_id, auth.uid())
);