-- Allow managers/owners to UPDATE compensation history records
-- This enables backdating rate changes via upsert when an entry already exists
-- for the same employee + effective_date (e.g., from initial backfill at hire_date)

CREATE POLICY "Managers can update comp history for their restaurants"
  ON employee_compensation_history FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.restaurant_id = employee_compensation_history.restaurant_id
      AND user_restaurants.user_id = auth.uid()
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );
