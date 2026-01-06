-- Fix shift_trades RLS policy to ensure restaurant_id matches employee's restaurant
-- This prevents RLS violations when creating trades

-- Drop the old policy
DROP POLICY IF EXISTS "Employees can create trades for their own shifts" ON shift_trades;

-- Create improved policy that checks both user_id and restaurant_id
CREATE POLICY "Employees can create trades for their own shifts"
  ON shift_trades FOR INSERT
  WITH CHECK (
    -- Employee must be the one creating the trade
    offered_by_employee_id IN (
      SELECT id FROM employees
      WHERE user_id = auth.uid()
      AND is_active = true
    )
    AND
    -- Restaurant ID must match the employee's restaurant
    restaurant_id IN (
      SELECT restaurant_id FROM employees
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  );

-- Add DELETE policies
CREATE POLICY "Employees can delete their own cancelled trades"
  ON shift_trades FOR DELETE
  USING (
    offered_by_employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
    AND status IN ('open', 'cancelled')
  );

CREATE POLICY "Managers can delete shift trades"
  ON shift_trades FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM user_restaurants
      WHERE user_restaurants.user_id = auth.uid()
      AND user_restaurants.restaurant_id = shift_trades.restaurant_id
      AND user_restaurants.role IN ('owner', 'manager')
    )
  );

-- Add helpful comments
COMMENT ON POLICY "Employees can create trades for their own shifts" ON shift_trades IS 
  'Employees can create shift trades for their own shifts. Both employee and restaurant must match.';

COMMENT ON POLICY "Employees can delete their own cancelled trades" ON shift_trades IS
  'Employees can delete shift trades they created if status is open or cancelled.';

COMMENT ON POLICY "Managers can delete shift trades" ON shift_trades IS
  'Managers and owners can delete any shift trades in their restaurants.';
