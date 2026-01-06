-- Migration: Add termination_date parameter to deactivate_employee function
-- This ensures payroll calculations stop after the termination date

-- Drop the existing function (with old signature)
DROP FUNCTION IF EXISTS deactivate_employee(UUID, UUID, TEXT, BOOLEAN);

-- Recreate function with termination_date parameter
CREATE OR REPLACE FUNCTION deactivate_employee(
  p_employee_id UUID,
  p_deactivated_by UUID,
  p_reason TEXT DEFAULT NULL,
  p_remove_from_future_shifts BOOLEAN DEFAULT true,
  p_termination_date DATE DEFAULT CURRENT_DATE
)
RETURNS employees AS $$
DECLARE
  v_employee employees;
BEGIN
  -- Update employee status
  UPDATE employees
  SET 
    is_active = false,
    status = 'inactive',
    deactivation_reason = p_reason,
    deactivated_at = NOW(),
    deactivated_by = p_deactivated_by,
    reactivated_at = NULL,
    reactivated_by = NULL,
    termination_date = p_termination_date  -- CRITICAL: Set termination date for payroll
  WHERE id = p_employee_id
  RETURNING * INTO v_employee;

  -- Optionally cancel future shifts
  IF p_remove_from_future_shifts THEN
    UPDATE shifts
    SET status = 'cancelled'
    WHERE employee_id = p_employee_id
      AND start_time > NOW()
      AND status = 'scheduled';
  END IF;

  RETURN v_employee;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions on function
GRANT EXECUTE ON FUNCTION deactivate_employee TO authenticated;

-- Add comment explaining the critical nature of termination_date
COMMENT ON FUNCTION deactivate_employee IS 
'Deactivates an employee and sets their termination date. CRITICAL: The termination_date parameter is required for payroll calculations to stop salary/contractor allocations after this date. Can be set to a future date for employees giving notice.';
