-- Add RLS policies for employee self-service access to time-off requests and availability

-- ============================================================================
-- TIME-OFF REQUESTS: Employee Self-Service Policies
-- ============================================================================

-- Allow employees to view their own time-off requests
CREATE POLICY "Employees can view own time-off requests"
  ON time_off_requests FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to create their own time-off requests
CREATE POLICY "Employees can create own time-off requests"
  ON time_off_requests FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to update their own pending time-off requests
-- (they can only edit if status is 'pending', not approved/rejected)
CREATE POLICY "Employees can update own pending time-off requests"
  ON time_off_requests FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
    AND status = 'pending'
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
    AND status = 'pending'
  );

-- Allow employees to delete their own pending time-off requests
CREATE POLICY "Employees can delete own pending time-off requests"
  ON time_off_requests FOR DELETE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
    AND status = 'pending'
  );

-- ============================================================================
-- EMPLOYEE AVAILABILITY: Employee Self-Service Policies
-- ============================================================================

-- Allow employees to view their own availability
CREATE POLICY "Employees can view own availability"
  ON employee_availability FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to create their own availability
CREATE POLICY "Employees can create own availability"
  ON employee_availability FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to update their own availability
CREATE POLICY "Employees can update own availability"
  ON employee_availability FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to delete their own availability
CREATE POLICY "Employees can delete own availability"
  ON employee_availability FOR DELETE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- AVAILABILITY EXCEPTIONS: Employee Self-Service Policies
-- ============================================================================

-- Allow employees to view their own availability exceptions
CREATE POLICY "Employees can view own availability exceptions"
  ON availability_exceptions FOR SELECT
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to create their own availability exceptions
CREATE POLICY "Employees can create own availability exceptions"
  ON availability_exceptions FOR INSERT
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to update their own availability exceptions
CREATE POLICY "Employees can update own availability exceptions"
  ON availability_exceptions FOR UPDATE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- Allow employees to delete their own availability exceptions
CREATE POLICY "Employees can delete own availability exceptions"
  ON availability_exceptions FOR DELETE
  USING (
    employee_id IN (
      SELECT id FROM employees WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- HELPER FUNCTION: Get current employee ID for logged-in user
-- ============================================================================

-- This function helps components easily get the employee_id for the current user
CREATE OR REPLACE FUNCTION get_current_employee_id(p_restaurant_id UUID)
RETURNS UUID AS $$
DECLARE
  v_employee_id UUID;
  v_has_access BOOLEAN;
BEGIN
  -- First verify user has access to this restaurant
  SELECT EXISTS (
    SELECT 1 FROM user_restaurants
    WHERE user_id = auth.uid()
      AND restaurant_id = p_restaurant_id
  ) INTO v_has_access;
  
  -- If no access, return NULL
  IF NOT v_has_access THEN
    RETURN NULL;
  END IF;
  
  -- Get the employee ID for the current user
  SELECT id INTO v_employee_id
  FROM employees
  WHERE user_id = auth.uid()
    AND restaurant_id = p_restaurant_id
    AND status = 'active'
  LIMIT 1;
  
  RETURN v_employee_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

COMMENT ON FUNCTION get_current_employee_id IS 'Returns the employee_id for the currently authenticated user in the specified restaurant';

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_current_employee_id TO authenticated;
