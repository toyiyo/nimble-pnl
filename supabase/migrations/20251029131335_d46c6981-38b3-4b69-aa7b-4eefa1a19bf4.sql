-- Update RLS policy to allow deletion of in_progress reconciliations
DROP POLICY IF EXISTS "Users can delete draft reconciliations" ON inventory_reconciliations;

CREATE POLICY "Users can delete draft or in_progress reconciliations" 
ON inventory_reconciliations FOR DELETE
USING (
  status IN ('draft', 'in_progress') 
  AND EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_restaurants.restaurant_id = inventory_reconciliations.restaurant_id
    AND user_restaurants.user_id = auth.uid()
    AND user_restaurants.role IN ('owner', 'manager', 'chef')
  )
);