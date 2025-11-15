-- Helper function to manually link an employee to a user account
-- This can be used by managers to fix cases where automatic linking didn't work

CREATE OR REPLACE FUNCTION link_employee_to_user(
  p_employee_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  success BOOLEAN,
  message TEXT,
  employee_name TEXT,
  employee_email TEXT
) AS $$
DECLARE
  v_employee RECORD;
  v_user RECORD;
BEGIN
  -- Get employee details
  SELECT * INTO v_employee FROM employees WHERE id = p_employee_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Employee not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Get user details
  SELECT email INTO v_user FROM auth.users WHERE id = p_user_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'User not found'::TEXT, NULL::TEXT, NULL::TEXT;
    RETURN;
  END IF;

  -- Check if employee already linked
  IF v_employee.user_id IS NOT NULL THEN
    RETURN QUERY SELECT FALSE, 
      format('Employee already linked to user %s', v_employee.user_id)::TEXT,
      v_employee.name::TEXT,
      v_employee.email::TEXT;
    RETURN;
  END IF;

  -- Link employee to user
  UPDATE employees 
  SET user_id = p_user_id, updated_at = NOW()
  WHERE id = p_employee_id;

  RETURN QUERY SELECT TRUE,
    format('Successfully linked %s to user %s', v_employee.name, v_user.email)::TEXT,
    v_employee.name::TEXT,
    v_employee.email::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION link_employee_to_user(UUID, UUID) TO authenticated;

-- Example usage:
-- SELECT * FROM link_employee_to_user(
--   'employee-id-here'::UUID,
--   'user-id-here'::UUID
-- );

COMMENT ON FUNCTION link_employee_to_user IS 'Helper function to manually link an employee record to a user account. Used when automatic linking fails during invitation acceptance.';
