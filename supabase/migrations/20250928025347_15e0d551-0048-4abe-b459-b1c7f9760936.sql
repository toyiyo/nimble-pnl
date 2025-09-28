-- Add RLS policy to allow team members to view each other's profiles within the same restaurant
CREATE POLICY "Team members can view profiles within their restaurants"
ON public.profiles
FOR SELECT
USING (
  EXISTS (
    SELECT 1 
    FROM user_restaurants ur1
    JOIN user_restaurants ur2 ON ur1.restaurant_id = ur2.restaurant_id
    WHERE ur1.user_id = auth.uid() 
    AND ur2.user_id = profiles.user_id
  )
);