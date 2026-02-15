CREATE POLICY "All restaurant users can view Gusto connections"
ON gusto_connections
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = gusto_connections.restaurant_id
    AND user_restaurants.user_id = auth.uid()
  )
);
